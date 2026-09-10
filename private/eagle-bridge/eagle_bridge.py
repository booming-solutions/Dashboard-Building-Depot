#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 EAGLE BRIDGE  —  vooruitbetalingen Keukendepot
 Booming Solutions / Building Depot
============================================================

Voert de door het dashboard goedgekeurde vooruitbetalingen in
Eagle in, in het scherm "New A/P Transactions".

HOE VELDEN WORDEN GEVONDEN
  Eagle geeft zijn invoervakken geen bruikbare namen: ze heten
  allemaal '1' of '1562'. Volgorde is ook niet betrouwbaar.
  Daarom worden velden gezocht op hun PLEK binnen het deelvenster
  (afstand tot de linkerbovenhoek). Dat verschuift niet als het
  venster wordt verplaatst, en als Eagle ooit wijzigt vindt de
  Bridge het veld niet meer en stopt hij — in plaats van in het
  verkeerde vakje te typen.

GRONDREGELS (niet aanpassen zonder overleg)
  1. Elk veld wordt na het typen teruggelezen. Klopt het niet,
     dan stopt de Bridge vóór "Add F4" — er is dan niets geboekt.
  2. Alleen dialogen uit BEKENDE_DIALOGEN worden beantwoord.
     Elk ander venster: stoppen, schermafdruk, melden.
  3. Elke geboekte regel gaat met zijn dedupeKey in ledger.jsonl.
     Een herstart slaat die regels over. Dubbel boeken kan niet.
  4. Bij twijfel stoppen. Nooit gokken.

GEBRUIK
  py -3 eagle_bridge.py doctor
  py -3 eagle_bridge.py calibrate
  py -3 eagle_bridge.py run batch.eaglebatch --dry-run
  py -3 eagle_bridge.py run batch.eaglebatch --limit 1
  py -3 eagle_bridge.py run batch.eaglebatch
  py -3 eagle_bridge.py register

BENODIGD
  Python 3.9+ van python.org (niet uit de Microsoft Store), plus:
      py -3 -m pip install pywinauto pillow
============================================================
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = Path(os.environ.get("APPDATA", Path.home())) / "EagleBridge"
LEDGER_PATH = APP_DIR / "ledger.jsonl"
LOG_DIR = APP_DIR / "logs"
SHOT_DIR = APP_DIR / "screenshots"


def config_pad() -> Path:
    """config.json naast het script heeft voorrang; anders %APPDATA%."""
    lokaal = SCRIPT_DIR / "config.json"
    if lokaal.exists():
        return lokaal
    roaming = APP_DIR / "config.json"
    if roaming.exists():
        return roaming
    return lokaal


# ------------------------------------------------------------------ config

STANDAARD_CONFIG = {
    "_uitleg": (
        "Velden worden gezocht op hun plek binnen het deelvenster. "
        "rel = [afstand vanaf links, afstand vanaf boven] in pixels, "
        "gemeten vanaf de linkerbovenhoek van het deelvenster (parent). "
        "tol = hoeveel pixels het mag afwijken. Draai 'calibrate' opnieuw "
        "als Eagle is gewijzigd."
    ),
    "window_title_re": ".*New A/P Transactions.*",
    "backend": "uia",

    "pace_seconds": 0.25,
    "dialog_wait_seconds": 8.0,
    "field_retries": 2,
    "tolerantie": 20,

    # Eagle valideert een keuzeveld pas als je het verlaat. Zonder deze toets
    # blijft de waarde "not on file" en rekent Eagle niets uit.
    "commit_key": "{TAB}",

    # parent = auto_id van het deelvenster (Window) waarin het veld zit.
    "fields": {},

    "distribution": {
        "window_title_re": ".*[Aa]dd distribution.*",
        "gekalibreerd": False,
        "account_main": {"index": 0},
        "account_sub": {"index": 1},
        "job": {"index": 2},
        "amount": {"index": 3},
        "ok_button": "OK",
    },

    "current_voucher": {},
    "niet_aanraken": ["Check Date", "Check No", "Bank Code", "Applies To", "PO Number", "Remit To"],
}

BEKENDE_DIALOGEN = [
    {
        "bevat": "apply to invoice not found",
        "antwoord": "Yes",
        "uitleg": "Er is geen originele factuur om tegen af te boeken. Hoort erbij.",
    },
    {
        "bevat": "voucher date earlier than 60 days ago",
        "antwoord": "STOP",
        "uitleg": "De boekdatum ligt te ver terug. Controleer de datum in het dashboard.",
    },
    {
        "bevat": "invoice date earlier than 60 days ago",
        "antwoord": "STOP",
        "uitleg": "De boekdatum ligt te ver terug. Controleer de datum in het dashboard.",
    },
]

# Volgorde waarin de velden worden ingevuld.
# Due Date en Disc Date staan bewust ACHTERAAN: Eagle herrekent ze soms
# zelf op basis van de terms code, dus wij zetten ze als laatste vast.
INVOERVOLGORDE = [
    "trx_type", "voucher_date", "invoice_date", "vendor", "vendor_ref_no",
    "ap_account_main", "ap_account_sub", "terms_code", "voucher_ref", "invoice_amount",
    "due_date", "disc_date",
]


# ------------------------------------------------------------------ logging

class Log:
    def __init__(self):
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.path = LOG_DIR / f"bridge-{stamp}.log"
        self.fh = open(self.path, "a", encoding="utf-8")

    def __call__(self, msg, level="INFO"):
        line = f"{dt.datetime.now().strftime('%H:%M:%S')} {level:5} {msg}"
        print(line, flush=True)
        self.fh.write(line + "\n")
        self.fh.flush()

    def close(self):
        try:
            self.fh.close()
        except Exception:
            pass


log = None


# ------------------------------------------------------------------ helpers

def laad_config():
    pad = config_pad()
    if not pad.exists():
        pad.parent.mkdir(parents=True, exist_ok=True)
        pad.write_text(json.dumps(STANDAARD_CONFIG, indent=2, ensure_ascii=False), encoding="utf-8")
        return dict(STANDAARD_CONFIG), pad, True
    cfg = json.loads(pad.read_text(encoding="utf-8"))
    for k, v in STANDAARD_CONFIG.items():
        cfg.setdefault(k, v)
    return cfg, pad, False


def bewaar_config(cfg, pad):
    pad.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")


def config_is_ingevuld(cfg):
    velden = cfg.get("fields") or {}
    for naam in INVOERVOLGORDE:
        spec = velden.get(naam)
        if not spec or "rel" not in spec:
            return False, naam
    return True, None


def geboekte_sleutels():
    if not LEDGER_PATH.exists():
        return {}
    uit = {}
    for regel in LEDGER_PATH.read_text(encoding="utf-8").splitlines():
        regel = regel.strip()
        if not regel:
            continue
        try:
            rec = json.loads(regel)
            if rec.get("status") in ("geboekt", "geboekt_handmatig"):
                uit[rec["dedupeKey"]] = rec
        except Exception:
            continue
    return uit


def schrijf_ledger(rec):
    APP_DIR.mkdir(parents=True, exist_ok=True)
    with open(LEDGER_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


def schermafdruk(naam):
    try:
        from PIL import ImageGrab
        SHOT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        pad = SHOT_DIR / f"{stamp}-{naam}.png"
        ImageGrab.grab().save(pad)
        return pad
    except Exception as e:
        log(f"schermafdruk mislukt: {e}", "WARN")
        return None


def dump_controls(win, pad, kop):
    regels = [kop, "=" * 78]
    try:
        alles = win.descendants()
    except Exception as e:
        regels.append(f"(uitlezen mislukt: {e})")
        alles = []
    idx = 0
    for c in alles:
        try:
            info = c.element_info
            ct = getattr(info, "control_type", "") or info.class_name
            naam = (info.name or "").strip()
            aid = (getattr(info, "automation_id", "") or "").strip()
            rect = info.rectangle
            tekst = (c.window_text() or "").strip()
        except Exception:
            continue
        extra = ""
        if str(ct).lower().startswith("edit"):
            extra = f"  index={idx}"
            idx += 1
        regels.append(f"[{ct}]{extra}  auto_id='{aid}'  name='{naam}'  text='{tekst}'  pos={rect}")
    pad.write_text("\n".join(regels), encoding="utf-8")
    return len(alles), idx


def grijs_klein(afbeelding, breedte=128, hoogte=36):
    return afbeelding.convert("L").resize((breedte, hoogte))


def beeldverschil(a, b):
    """Gemiddeld verschil per beeldpunt tussen twee even grote grijsplaatjes."""
    pa, pb = list(a.getdata()), list(b.getdata())
    if len(pa) != len(pb):
        return 255.0
    return sum(abs(x - y) for x, y in zip(pa, pb)) / len(pa)


def schermuitsnede(bbox):
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=bbox, all_screens=True)


class BridgeStop(Exception):
    """
    Gecontroleerd stoppen.

    na_add=False: gestopt vóór Add F4 — er staat niets in Eagle.
    na_add=True : gestopt ná Add F4 — de kopregel bestaat al in Eagle en
                  moet door een mens afgemaakt of verwijderd worden. Zo'n
                  regel wordt in het ledger als 'geboekt_handmatig' gezet,
                  zodat een herstart hem nooit nog een keer toevoegt.
    """
    def __init__(self, bericht, na_add=False):
        super().__init__(bericht)
        self.na_add = na_add


# ------------------------------------------------------------------ Eagle

class Eagle:
    def __init__(self, cfg):
        self.cfg = cfg
        self.pace = float(cfg.get("pace_seconds", 0.25))
        self.tol = int(cfg.get("tolerantie", 20))
        from pywinauto import Desktop
        self.desktop = Desktop(backend=cfg.get("backend", "uia"))
        self.win = None
        self._panes = {}
        self._win32 = None
        self.schaal = float(cfg.get("schaal") or 1.0)

    # -- venster ---------------------------------------------------------

    def verbind(self):
        try:
            self.win = self.desktop.window(title_re=self.cfg["window_title_re"])
            self.win.wait("exists ready", timeout=10)
        except Exception:
            raise BridgeStop(
                "Het scherm 'New A/P Transactions' is niet gevonden.\n"
                "Open Eagle op: Accounts Payable > Daily Procedures > New A/P Transactions,\n"
                "laat het scherm leeg staan en start opnieuw."
            )
        self.win.set_focus()
        time.sleep(self.pace)
        self._panes = {}
        self._bepaal_schaal()
        return self.win

    SCHALEN = [1.0, 1.25, 0.8, 1.5, 0.6667, 1.75, 0.5714, 2.0, 0.5, 1.2, 0.8333, 1.4, 0.7143, 1.6, 0.625]

    def _bepaal_schaal(self):
        """
        Zoekt de schaalfactor waarbij ALLE velden uit config.json gevonden
        worden. Meestal is dat de onthouden waarde; op een scherm met een
        andere Windows-schaal wordt de nieuwe factor gevonden en bewaard.
        """
        velden = self.cfg.get("fields") or {}
        specs = [v for v in velden.values() if isinstance(v, dict) and "rel" in v]
        if not specs:
            return

        onthouden = self.cfg.get("schaal")
        kandidaten = list(self.SCHALEN)
        if onthouden:
            kandidaten = [float(onthouden)] + [k for k in kandidaten if abs(k - float(onthouden)) > 0.01]

        for k in kandidaten:
            self.schaal = k
            self._panes = {}
            try:
                ok = all(self.zoek_alle_op_plek(sp["parent"], sp["rel"], sp.get("tol")) for sp in specs)
            except BridgeStop:
                ok = False
            except Exception:
                ok = False
            if ok:
                if abs(k - float(onthouden or 0)) > 0.01:
                    log(f"  schermschaal bepaald: {k:g}× ten opzichte van de calibratie — onthouden")
                    self._onthoud_schaal(k)
                return
        self.schaal = float(onthouden or 1.0)
        log("  schermschaal: geen factor gevonden waarbij alle velden kloppen; "
            "de velden zelf melden straks wat er mist", "WARN")

    def _onthoud_schaal(self, k):
        try:
            pad = config_pad()
            cfg = json.loads(pad.read_text(encoding="utf-8"))
            cfg["schaal"] = round(k, 4)
            cfg["_schaal_uitleg"] = ("Verhouding tussen de Windows-schaal van het scherm waarop de Bridge draait "
                                     "en die van de calibratie. Wordt automatisch bepaald en bijgewerkt.")
            pad.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            self.cfg["schaal"] = round(k, 4)
        except Exception as e:
            log(f"kon de schermschaal niet opslaan: {e}", "WARN")

    def deelvenster(self, auto_id):
        """Het deelvenster (Window) met dit auto_id, bijv. '32768' of '32770'."""
        if auto_id in self._panes:
            return self._panes[auto_id]
        gevonden = None
        try:
            for c in self.win.descendants():
                try:
                    info = c.element_info
                    if (getattr(info, "automation_id", "") or "") == str(auto_id):
                        gevonden = c
                        break
                except Exception:
                    continue
        except Exception:
            pass
        if gevonden is None:
            raise BridgeStop(
                f"Deelvenster '{auto_id}' niet gevonden in het Eagle-scherm.\n"
                "Draai 'py -3 eagle_bridge.py calibrate' opnieuw."
            )
        self._panes[auto_id] = gevonden
        return gevonden

    # -- veld opzoeken op plek -------------------------------------------

    def zoek_alle_op_plek(self, parent_id, rel, tol=None):
        """
        Alle bedieningselementen op deze relatieve plek, beste eerst.

        Eagle zet per veld meerdere elementen op exact dezelfde plek: een
        leeg omhulsel, een omhulsel dat de waarde draagt, en soms een echt
        invoervak. Daarom geven we ze allemaal terug — typen doen we in de
        eerste, teruglezen over alle.
        """
        # Alle afstanden zijn vastgelegd op de schaal van de calibratie. Op
        # een scherm met een andere Windows-schaal (100% / 125% / 150%) is
        # alles evenredig groter of kleiner; die factor is self.schaal.
        tol = (self.tol if tol is None else tol) * self.schaal
        parent = self.deelvenster(parent_id)
        prect = parent.element_info.rectangle
        doel_l, doel_t = rel[0] * self.schaal, rel[1] * self.schaal

        soorten = {"edit": 0, "combobox": 1, "custom": 2, "pane": 3}
        treffers = []

        for c in parent.descendants():
            try:
                info = c.element_info
                ct = str(getattr(info, "control_type", "") or info.class_name).lower()
                if ct not in soorten:
                    continue
                r = info.rectangle
                if r.right - r.left <= 2 or r.bottom - r.top <= 2:
                    continue
                dl = (r.left - prect.left) - doel_l
                dt_ = (r.top - prect.top) - doel_t
                afstand = (dl * dl + dt_ * dt_) ** 0.5
                if afstand > tol:
                    continue
                treffers.append((soorten[ct], afstand, c))
            except Exception:
                continue

        treffers.sort(key=lambda t: (t[0], t[1]))
        return [t[2] for t in treffers]

    def zoek_op_plek(self, parent_id, rel, tol=None):
        alle = self.zoek_alle_op_plek(parent_id, rel, tol)
        return alle[0] if alle else None

    def _omgeving_van_plek(self, parent_id, rel, n=6):
        """Voor het logboek: waar staat het deelvenster, en wat staat er in de buurt."""
        regels = []
        try:
            parent = self.deelvenster(parent_id)
            pr = parent.element_info.rectangle
            regels.append(f"deelvenster {parent_id}: pos=({pr.left},{pr.top})-({pr.right},{pr.bottom}) "
                          f"breedte={pr.right-pr.left} hoogte={pr.bottom-pr.top}")
            kandidaten = []
            for c in parent.descendants():
                try:
                    info = c.element_info
                    ct = str(getattr(info, "control_type", "") or info.class_name).lower()
                    if ct not in ("edit", "combobox", "custom", "pane"):
                        continue
                    r = info.rectangle
                    if r.right - r.left <= 2 or r.bottom - r.top <= 2:
                        continue
                    rl, rt = r.left - pr.left, r.top - pr.top
                    afstand = ((rl - rel[0]*self.schaal) ** 2 + (rt - rel[1]*self.schaal) ** 2) ** 0.5
                    kandidaten.append((afstand, ct, rl, rt, (c.window_text() or "")[:20]))
                except Exception:
                    continue
            kandidaten.sort()
            regels.append(f"gezocht op rel=({rel[0]},{rel[1]}) × schaal {self.schaal:g} = "
                          f"({rel[0]*self.schaal:.0f},{rel[1]*self.schaal:.0f}); dichtstbijzijnde elementen:")
            for afstand, ct, rl, rt, tekst in kandidaten[:n]:
                regels.append(f"  [{ct}] rel=({rl},{rt}) afstand={afstand:.0f} tekst='{tekst}'")
            if not kandidaten:
                regels.append("  (geen invoerelementen gevonden in dit deelvenster)")
        except Exception as e:
            regels.append(f"(omgeving niet uit te lezen: {e})")
        return regels

    def zoek_veld_alle(self, naam, spec):
        if not spec or "rel" not in spec:
            raise BridgeStop(f"Veld '{naam}' staat niet in config.json. Draai eerst 'calibrate'.")
        alle = self.zoek_alle_op_plek(spec["parent"], spec["rel"], spec.get("tol"))
        if not alle:
            # Eén keer opnieuw, met een vers opgezocht deelvenster: het venster
            # kan intussen zijn herschikt of opnieuw opgebouwd.
            self._panes = {}
            time.sleep(self.pace)
            alle = self.zoek_alle_op_plek(spec["parent"], spec["rel"], spec.get("tol"))
        if not alle:
            for regel in self._omgeving_van_plek(spec["parent"], spec["rel"]):
                log("    " + regel, "WARN")
            pad = schermafdruk(f"veld-niet-gevonden-{naam}")
            raise BridgeStop(
                f"Veld '{naam}' staat niet op de verwachte plek in het Eagle-scherm.\n"
                "Hierboven staat waar het deelvenster nu staat en wat er in de buurt gevonden is.\n"
                "Mogelijke oorzaken: ander scherm of andere schaal, venster anders van grootte, "
                "of Eagle staat niet op tabblad '1. Main'."
                + (f"\nSchermafdruk: {pad}" if pad else "")
            )
        return alle

    def zoek_veld(self, naam, spec):
        if not spec or "rel" not in spec:
            raise BridgeStop(f"Veld '{naam}' staat niet in config.json. Draai eerst 'calibrate'.")
        c = self.zoek_op_plek(spec["parent"], spec["rel"], spec.get("tol"))
        if c is None:
            raise BridgeStop(
                f"Veld '{naam}' staat niet op de verwachte plek in het Eagle-scherm.\n"
                "Waarschijnlijk is het scherm gewijzigd of staat Eagle op een andere weergave.\n"
                "Draai 'py -3 eagle_bridge.py calibrate' en stuur de nieuwe controls.txt door."
            )
        return c

    # -- invoeren --------------------------------------------------------

    @staticmethod
    def _klik_in_veld(c):
        """Klikt links in het veld, ruim weg van een eventueel uitklappijltje."""
        try:
            r = c.rectangle()
            hoogte = max(1, r.bottom - r.top)
            c.click_input(coords=(6, hoogte // 2))
            return
        except Exception:
            pass
        try:
            c.click_input()
            return
        except Exception:
            pass
        c.set_focus()

    @staticmethod
    def _lees(c):
        """
        Leest de waarde van een element.

        Eagle gebruikt oude Windows-besturingselementen. De moderne
        uitleesmanier (Name / window_text) geeft bij keuzevelden niets terug,
        terwijl de klassieke toegankelijkheidslaag de waarde wel kent.
        Daarom proberen we ze op volgorde; de eerste niet-lege telt.
        """
        pogingen = []
        try:
            pogingen.append(c.window_text())
        except Exception:
            pass
        try:
            pogingen.append(c.element_info.name)
        except Exception:
            pass
        try:
            lp = c.legacy_properties() or {}
            pogingen.append(lp.get("Value"))
            pogingen.append(lp.get("Name"))
        except Exception:
            pass
        try:
            pogingen.append(c.iface_value.CurrentValue)
        except Exception:
            pass

        for v in pogingen:
            if v is None:
                continue
            v = str(v).strip()
            if v:
                return v
        return ""

    # Manieren om een waarde in een veld te krijgen. Eagle gebruikt per veld
    # een ander soort invoervak: gewone tekstvakken, keuzevelden, en
    # datumvelden met een vast invulmasker. Wat bij het ene werkt, maakt bij
    # het andere rommel. De Bridge probeert ze daarom op volgorde en
    # controleert na elke poging; de manier die werkt wordt onthouden in
    # config.json, zodat het de volgende keer meteen goed gaat.
    STRATEGIEEN = ["selectie", "cijfers_wis", "cijfers_home", "settext", "settext_cijfers"]

    def _voer_in(self, doel, waarde, strategie):
        cijfers = re.sub(r"\D", "", waarde)
        pauze = self.pace / 2

        if strategie == "selectie":
            doel.type_keys("^a{DEL}", set_foreground=False)
            time.sleep(pauze)
            doel.type_keys(waarde, with_spaces=True, set_foreground=False)

        elif strategie == "cijfers_wis":
            doel.type_keys("{END}" + "{BACKSPACE 14}", set_foreground=False)
            time.sleep(pauze)
            doel.type_keys(cijfers, set_foreground=False)

        elif strategie == "cijfers_home":
            doel.type_keys("{HOME}", set_foreground=False)
            time.sleep(pauze)
            doel.type_keys(cijfers, set_foreground=False)

        elif strategie == "settext":
            doel.set_edit_text(waarde)

        elif strategie == "settext_cijfers":
            doel.set_edit_text(cijfers)

        else:
            raise BridgeStop(f"Onbekende invoermanier '{strategie}' in config.json.")

    def _lees_veld(self, naam, spec):
        """Leest alle elementen op de plek van dit veld; eerste niet-lege telt."""
        gelezen, gezien = "", []
        for c in self.zoek_veld_alle(naam, spec):
            v = self._lees(c)
            gezien.append(v)
            if v and not gelezen:
                gelezen = v
        return gelezen, gezien

    def vul(self, naam, spec, waarde):
        waarde = "" if waarde is None else str(waarde)

        # De onthouden manier eerst; werkt die een keer niet (bijvoorbeeld
        # omdat het veld nu wél al een waarde bevat), dan alsnog de rest.
        vast = spec.get("strategie")
        volgorde = ([vast] + [x for x in self.STRATEGIEEN if x != vast]) if vast else list(self.STRATEGIEEN)

        laatste = ""
        for strategie in volgorde:
            kandidaten = self.zoek_veld_alle(naam, spec)
            doel = kandidaten[0]
            try:
                self._klik_in_veld(doel)
                time.sleep(self.pace / 2)
                self._voer_in(doel, waarde, strategie)
                time.sleep(self.pace)

                # Bevestigen. Eagle valideert keuzevelden pas bij het verlaten
                # van het veld: zonder dit blijft er "not on file" staan.
                commit = spec.get("commit", self.cfg.get("commit_key", "{TAB}"))
                if commit:
                    doel.type_keys(commit, set_foreground=False)
                    time.sleep(self.pace)
            except Exception as e:
                log(f"veld '{naam}' via '{strategie}' mislukt: {e}", "WARN")
                continue

            if spec.get("verify") is False:
                log(f"  {naam:18} = {waarde}   (waarde niet uit te lezen; Eagle controleert bij Add)")
                return True

            gelezen, gezien = self._lees_veld(naam, spec)
            laatste = gelezen
            if self._gelijk(gelezen, waarde):
                log(f"  {naam:18} = {waarde}" + ("" if strategie == vast else f"   (manier: {strategie})"))
                if strategie != vast:
                    self._onthoud_strategie(naam, strategie)
                return True

            log(f"veld '{naam}': manier '{strategie}' gaf '{gelezen}', verwacht '{waarde}' "
                f"(alles op die plek: {gezien})", "WARN")

        raise BridgeStop(
            f"Veld '{naam}' laat zich niet invullen: verwacht '{waarde}', "
            f"laatst gelezen '{laatste}'.\n"
            f"Alle invoermanieren geprobeerd: {', '.join(volgorde)}.\n"
            "Er is niets geboekt."
        )

    def _onthoud_strategie(self, naam, strategie):
        """Bewaart de manier die werkte, zodat de volgende run niet zoekt."""
        try:
            pad = config_pad()
            cfg = json.loads(pad.read_text(encoding="utf-8"))
            if cfg.get("fields", {}).get(naam, {}).get("strategie") == strategie:
                return
            cfg["fields"][naam]["strategie"] = strategie
            pad.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            self.cfg["fields"][naam]["strategie"] = strategie
            log(f"    onthouden: '{naam}' vullen via '{strategie}'")
        except Exception as e:
            log(f"kon invoermanier voor '{naam}' niet opslaan: {e}", "WARN")

    @staticmethod
    def _gelijk(gelezen, verwacht):
        g = gelezen.replace(" ", "").replace(",", ".")
        v = verwacht.replace(" ", "").replace(",", ".")
        if g.upper() == v.upper():
            return True
        try:
            return abs(float(g) - float(v)) < 0.005
        except ValueError:
            pass
        return g.lstrip("0").upper() == v.lstrip("0").upper() and bool(v.strip("0"))

    # -- dialogen --------------------------------------------------------
    #
    # WAT HIER SPEELT
    #   Na "Add F4" toont Eagle een meldingsvenster met de titel
    #   "A/P Add New Transaction". Er blijkt óók een ander venster met
    #   precies die titel te bestaan (het onderliggende Visual Basic-
    #   formulier van het invoerscherm). De eerdere versie pakte het eerste
    #   venster met die titel, las daar geen tekst in, en stopte als
    #   "onbekend" — terwijl het echte meldingsvenster ernaast stond.
    #
    #   Daarom nu:
    #   1. Alle vensters met een meldingstitel worden bekeken, niet het eerste.
    #   2. Tekst wordt via twee lagen gelezen (klassiek én modern), want de
    #      vraag kan als gewone tekst staan óf als HTML in een ingebed
    #      browservak ("Shell Embedding") — dat laatste is alleen via de
    #      moderne laag leesbaar.
    #   3. Er wordt gewacht op een POSITIEF herkende toestand: een bekende
    #      vraag, of het distributiescherm. Komt geen van beide, dan stoppen
    #      we en schrijven we álle vensters weg, zodat er niets te raden valt.

    def _win32_desktop(self):
        from pywinauto import Desktop
        if self._win32 is None:
            self._win32 = Desktop(backend="win32")
        return self._win32

    @staticmethod
    def _handle_van(w):
        for haal in (lambda: w.handle, lambda: w.element_info.handle):
            try:
                h = haal()
                if h:
                    return int(h)
            except Exception:
                continue
        return None

    def _wrap_beide(self, handle):
        """Hetzelfde venster in beide lagen: (modern, klassiek)."""
        uia = w32 = None
        try:
            uia = self.desktop.window(handle=handle)
        except Exception:
            pass
        try:
            w32 = self._win32_desktop().window(handle=handle)
        except Exception:
            pass
        return uia, w32

    def _zichtbare_vensters(self):
        """Alle zichtbare hoofdvensters: (handle, titel, klasse, rechthoek)."""
        from pywinauto import findwindows
        uit = []
        try:
            for e in findwindows.find_elements(backend="win32", top_level_only=True, visible_only=True):
                try:
                    uit.append((int(e.handle), e.name or "", e.class_name or "", e.rectangle))
                except Exception:
                    continue
        except Exception as ex:
            log(f"vensters opsommen mislukt: {ex}", "WARN")
        return uit

    @staticmethod
    def _alle_teksten(wrapper):
        """Alle leesbare tekst in een venster, langs elke beschikbare weg."""
        stukken = []
        if wrapper is None:
            return stukken
        try:
            stukken.append(wrapper.window_text() or "")
        except Exception:
            pass
        try:
            elementen = wrapper.descendants()
        except Exception:
            elementen = []
        for c in elementen:
            lezers = (
                lambda: c.window_text(),
                lambda: c.element_info.name,
                lambda: (c.legacy_properties() or {}).get("Value"),
                lambda: (c.legacy_properties() or {}).get("Name"),
                lambda: c.iface_value.CurrentValue,
            )
            for lees in lezers:
                try:
                    t = lees()
                    if t:
                        stukken.append(str(t))
                except Exception:
                    continue
        return stukken

    def _tekst_van_venster(self, handle):
        uia, w32 = self._wrap_beide(handle)
        stukken = self._alle_teksten(w32) + self._alle_teksten(uia)
        return " ".join(stukken).lower()

    def _knoppen_in(self, handle, rect):
        """Zichtbare knoppen binnen het venster, gesorteerd op rij en van links naar rechts."""
        knoppen = []
        uia, w32 = self._wrap_beide(handle)
        for bron in (w32, uia):
            if bron is None:
                continue
            try:
                for c in bron.descendants():
                    try:
                        info = c.element_info
                        cls = (info.class_name or "").lower()
                        ct = str(getattr(info, "control_type", "") or "").lower()
                        if "command" not in cls and "button" not in cls and ct != "button":
                            continue
                        r = info.rectangle
                        if r.left < rect.left - 2 or r.right > rect.right + 2:
                            continue
                        if r.top < rect.top - 2 or r.bottom > rect.bottom + 2:
                            continue
                        if r.right - r.left < 20 or r.bottom - r.top < 12:
                            continue
                        if any(abs(r.left - k[1].left) < 4 and abs(r.top - k[1].top) < 4 for k in knoppen):
                            continue
                        knoppen.append((c, r))
                    except Exception:
                        continue
            except Exception:
                continue
            if knoppen:
                break
        knoppen.sort(key=lambda k: (k[1].top, k[1].left))
        return knoppen

    def _meldingsvensters(self):
        """
        Alle vensters die een melding van Eagle kunnen zijn.

        Per venster: de leesbare tekst (als die er is), de afmeting, het
        aantal zichtbare knoppen, en een klein grijsplaatje van het venster.
        De vraagtekst in Eagle-meldingen is een VB6-label zonder eigen
        venster en is dus door geen enkele laag uit te lezen; herkennen gaat
        daarom op vorm en beeld.
        """
        uit = []
        for handle, titel, klasse, rect in self._zichtbare_vensters():
            t = (titel or "").lower()
            if "add new transaction" not in t and "add distribution" not in t:
                continue
            knoppen = self._knoppen_in(handle, rect)
            beeld = None
            try:
                beeld = schermuitsnede((rect.left, rect.top, rect.right, rect.bottom))
            except Exception as e:
                log(f"schermuitsnede van '{titel}' mislukt: {e}", "WARN")
            uit.append({
                "handle": handle, "titel": titel, "klasse": klasse, "rect": rect,
                "breedte": rect.right - rect.left, "hoogte": rect.bottom - rect.top,
                "knoppen": knoppen, "beeld": beeld,
                "tekst": self._tekst_van_venster(handle),
            })
        return uit

    def _distributie_venster(self):
        for handle, titel, klasse, rect in self._zichtbare_vensters():
            if "add distribution" in (titel or "").lower():
                return handle
        return None

    def _venster_bestaat(self, handle):
        try:
            w = self._win32_desktop().window(handle=handle)
            return bool(w.exists()) and bool(w.is_visible())
        except Exception:
            return False

    def _dump_alles(self, reden):
        """Schrijft alle zichtbare vensters en de bomen van de kandidaten weg."""
        pad = SCRIPT_DIR / "controls-dialoog.txt"
        regels = [f"Vensteroverzicht — {reden}", "=" * 78, "ZICHTBARE HOOFDVENSTERS:"]
        kandidaten = []
        for handle, titel, klasse, rect in self._zichtbare_vensters():
            regels.append(f"  handle={handle}  klasse='{klasse}'  titel='{titel}'  pos={rect}")
            t = (titel or "").lower()
            if "transaction" in t or "distribution" in t:
                kandidaten.append((handle, titel))
        for handle, titel in kandidaten:
            uia, w32 = self._wrap_beide(handle)
            for laag, wr in (("KLASSIEK", w32), ("MODERN", uia)):
                regels += ["", "=" * 78, f"[{laag}] handle={handle} titel='{titel}'", "-" * 78]
                if wr is None:
                    regels.append("(niet beschikbaar)")
                    continue
                try:
                    for c in wr.descendants():
                        try:
                            info = c.element_info
                            ct = getattr(info, "control_type", "") or info.class_name
                            regels.append(
                                f"[{ct}]  klasse='{info.class_name}'  naam='{(info.name or '').strip()}'  "
                                f"tekst='{(c.window_text() or '').strip()}'  pos={info.rectangle}"
                            )
                        except Exception:
                            continue
                except Exception as e:
                    regels.append(f"(uitlezen mislukt: {e})")
        pad.write_text("\n".join(regels), encoding="utf-8")
        return pad

    def _beantwoord(self, handle, regel):
        """Klikt het gevraagde antwoord aan, en controleert dat het venster weggaat."""
        knop = regel["antwoord"]
        doel = knop.lower()
        uia, w32 = self._wrap_beide(handle)

        def naam_klopt(t):
            return (t or "").replace("&", "").strip().lower() == doel

        def wacht_tot_weg():
            einde = time.time() + 2.5
            while time.time() < einde:
                if not self._venster_bestaat(handle):
                    return True
                time.sleep(0.15)
            return False

        pogingen = []

        # 0. knop op positie in het venster ("links" / "rechts" / volgnummer),
        #    voor vensters waarvan de knoppen geen naam prijsgeven.
        if regel.get("knop") is not None:
            def p0():
                rect = None
                for h, titel, klasse, r in self._zichtbare_vensters():
                    if h == handle:
                        rect = r
                        break
                if rect is None:
                    return False
                knoppen = self._knoppen_in(handle, rect)
                if not knoppen:
                    return False
                # alleen de onderste rij knoppen telt
                onderste = max(k[1].top for k in knoppen)
                rij = [k for k in knoppen if abs(k[1].top - onderste) < 6]
                rij.sort(key=lambda k: k[1].left)
                keuze = regel["knop"]
                if keuze == "links":
                    c = rij[0][0]
                elif keuze == "rechts":
                    c = rij[-1][0]
                else:
                    c = rij[int(keuze)][0]
                r = c.element_info.rectangle
                # klik in het midden van de knop, via absolute schermpositie
                from pywinauto import mouse
                mouse.click(coords=((r.left + r.right) // 2, (r.top + r.bottom) // 2))
                return True
            pogingen.append((f"knop '{regel['knop']}' op positie", p0))

        # 1. moderne laag: knop op naam
        def p1():
            for c in uia.descendants(control_type="Button"):
                if naam_klopt(c.element_info.name):
                    c.click_input()
                    return True
            return False
        if uia is not None:
            pogingen.append(("knop op naam (modern)", p1))

        # 2. klassieke laag: gewone Windows-knop op tekst
        def p2():
            for c in w32.children():
                try:
                    if "button" in (c.class_name() or "").lower() and naam_klopt(c.window_text()):
                        c.click()
                        return True
                except Exception:
                    continue
            return False
        if w32 is not None:
            pogingen.append(("knop op tekst (klassiek)", p2))

        # 3. moderne laag: willekeurig element met die naam (Sheridan-knoppen)
        def p3():
            for c in uia.descendants():
                try:
                    if naam_klopt(c.element_info.name):
                        c.click_input()
                        return True
                except Exception:
                    continue
            return False
        if uia is not None:
            pogingen.append(("element op naam (modern)", p3))

        # 4. toetsenbord: sneltoets van de knop, daarna Enter (standaardknop)
        def p4():
            w = w32 or uia
            w.set_focus()
            time.sleep(0.2)
            w.type_keys("%" + doel[0], set_foreground=True)
            return True
        def p5():
            w = w32 or uia
            w.set_focus()
            time.sleep(0.2)
            w.type_keys("{ENTER}", set_foreground=True)
            return True
        pogingen.append(("sneltoets Alt+" + doel[0].upper(), p4))
        if doel in ("yes", "ok"):
            pogingen.append(("Enter op standaardknop", p5))

        # 5. vaste plek in het venster, als die in config staat
        if regel.get("klik") and (w32 or uia) is not None:
            def p6():
                w = w32 or uia
                r = w.rectangle()
                x = int((r.right - r.left) * float(regel["klik"][0]))
                y = int((r.bottom - r.top) * float(regel["klik"][1]))
                w.click_input(coords=(x, y))
                return True
            pogingen.append(("vaste plek", p6))

        for omschrijving, poging in pogingen:
            try:
                if not poging():
                    continue
            except Exception as e:
                log(f"    {omschrijving}: {e}", "WARN")
                continue
            if wacht_tot_weg():
                log(f"    beantwoord met '{knop}' via {omschrijving}")
                return True
            log(f"    {omschrijving}: venster bleef staan", "WARN")
        return False

    def _bekende_vraag(self, vensters):
        # 1. op tekst (werkt alleen als Eagle de tekst ooit prijsgeeft)
        for v in vensters:
            for regel in BEKENDE_DIALOGEN:
                if regel.get("bevat") and regel["bevat"] in v["tekst"]:
                    return regel, v

        # 2. op vorm en beeld, tegen de vastgelegde vensters in config.json
        bekend = self.cfg.get("dialogen") or []
        if not bekend:
            return None, None
        from PIL import Image
        drempel = float(self.cfg.get("beeld_drempel", 14))
        for v in vensters:
            if v["beeld"] is None:
                continue
            huidig = grijs_klein(v["beeld"])
            beste, beste_score = None, 999.0
            for regel in bekend:
                if regel.get("titel", "").lower() not in v["titel"].lower():
                    continue
                if regel.get("knoppen") is not None and regel["knoppen"] != len(v["knoppen"]):
                    continue
                # Vorm: verhouding breedte/hoogte (schaalonafhankelijk) en aantal knoppen.
                b, h = regel.get("breedte"), regel.get("hoogte")
                if b and h and v["hoogte"]:
                    if abs((v["breedte"] / v["hoogte"]) - (b / h)) / (b / h) > 0.10:
                        continue
                pad = SCRIPT_DIR / "dialogen" / regel["bestand"]
                if not pad.exists():
                    # Eerste keer: de vorm klopt, er is nog geen referentiebeeld.
                    # Dit beeld wordt de referentie; daarna moet ook het beeld kloppen.
                    try:
                        pad.parent.mkdir(parents=True, exist_ok=True)
                        v["beeld"].save(pad)
                        log(f"  venster op vorm herkend als '{regel['naam']}' — beeld vastgelegd als "
                            f"referentie: {pad.name}")
                    except Exception as e:
                        log(f"kon referentiebeeld niet opslaan: {e}", "WARN")
                    return regel, v
                try:
                    score = beeldverschil(huidig, grijs_klein(Image.open(pad)))
                except Exception as e:
                    log(f"vergelijken met {pad.name} mislukt: {e}", "WARN")
                    continue
                if score < beste_score:
                    beste, beste_score = regel, score
            if beste is not None and beste_score <= drempel:
                log(f"  venster herkend op beeld: '{beste['naam']}' (afwijking {beste_score:.1f})")
                return beste, v
            if beste is not None:
                log(f"  dichtstbijzijnde bekende venster '{beste['naam']}' wijkt te veel af "
                    f"({beste_score:.1f} > {drempel})", "WARN")
        return None, None

    def _leg_onbekend_vast(self, vensters):
        """Bewaart het beeld en de vorm van elk onbekend meldingsvenster."""
        map_ = SCRIPT_DIR / "dialogen"
        map_.mkdir(parents=True, exist_ok=True)
        paden = []
        for v in vensters:
            if v["beeld"] is None:
                continue
            stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
            pad = map_ / f"onbekend-{stamp}-{v['handle']}.png"
            try:
                v["beeld"].save(pad)
                paden.append(pad)
                log(f"  onbekend venster vastgelegd: {pad.name}  "
                    f"(titel '{v['titel']}', {v['breedte']}x{v['hoogte']}, {len(v['knoppen'])} knop(pen))")
            except Exception as e:
                log(f"kon het venster niet vastleggen: {e}", "WARN")
        return paden

    def verwerk_na_add(self, max_stappen=6):
        """
        Wacht na Add F4 op een positief herkende toestand en handelt die af.

        Geeft het vensternummer van het distributiescherm terug. Stopt met
        een volledige uitlezing als er binnen de wachttijd niets herkenbaars
        verschijnt — er wordt nooit op een onbekend venster geklikt.
        """
        wacht = float(self.cfg.get("dialog_wait_seconds", 8.0))

        for _ in range(max_stappen):
            einde = time.time() + wacht
            beantwoord = False
            gezien = []

            while time.time() < einde:
                h = self._distributie_venster()
                if h:
                    return h

                gezien = self._meldingsvensters()
                regel, v = self._bekende_vraag(gezien)
                if regel is None:
                    time.sleep(0.4)
                    continue

                if regel["antwoord"] == "STOP":
                    pad = schermafdruk("blokkade")
                    raise BridgeStop(regel["uitleg"] + (f"\nSchermafdruk: {pad}" if pad else ""), na_add=True)

                log(f"  dialoog: {regel['uitleg']}")
                if not self._beantwoord(v["handle"], regel):
                    pad = schermafdruk("knop-niet-klikbaar")
                    raise BridgeStop(
                        f"Kon '{regel['antwoord']}' niet aanklikken in het meldingsvenster."
                        + (f"\nSchermafdruk: {pad}" if pad else ""),
                        na_add=True,
                    )
                time.sleep(self.pace * 2)
                beantwoord = True
                break

            if beantwoord:
                continue  # opnieuw kijken wat er nu op het scherm staat

            pad = schermafdruk("onbekende-toestand")
            dump = self._dump_alles("geen bekende vraag en geen distributiescherm binnen de wachttijd")
            beelden = self._leg_onbekend_vast(gezien)
            samenvatting = "; ".join(
                f"'{v['titel']}' {v['breedte']}x{v['hoogte']} met {len(v['knoppen'])} knop(pen)"
                for v in gezien
            ) or "geen vensters met een meldingstitel"
            raise BridgeStop(
                "Na Add F4 verscheen een venster dat ik nog niet ken — gestopt zonder te raden.\n"
                f"Gezien: {samenvatting}\n"
                + (f"Beeld vastgelegd: {', '.join(p.name for p in beelden)}\n" if beelden else "")
                + f"Volledige uitlezing: {dump}\n"
                + (f"Schermafdruk: {pad}\n" if pad else ""),
                na_add=True,
            )

        raise BridgeStop("Te veel meldingsvensters achter elkaar na Add F4 — gestopt.", na_add=True)

    # -- distributie -----------------------------------------------------
    #
    #   Het scherm 'Add distribution' is nog niet met vaste posities
    #   gekoppeld. De eerste keer leidt de Bridge de indeling af uit de
    #   volgorde van boven naar beneden (rekening, sub, job, bedrag), vult
    #   de velden, controleert elk veld door terug te lezen, en STOPT dan
    #   vóór OK: de gebruiker ziet op het scherm of alles in het juiste vak
    #   staat en drukt zelf OK of Cancel. Tegelijk wordt de volledige
    #   structuur weggeschreven, zodat de posities daarna vast komen te staan.

    def vul_distributie(self, handle, account_main, account_sub, bedrag):
        dcfg = self.cfg["distribution"]
        uia, w32 = self._wrap_beide(handle)
        if uia is None and w32 is None:
            raise BridgeStop("Het distributiescherm is gevonden maar niet te benaderen.", na_add=True)

        try:
            (w32 or uia).set_focus()
        except Exception:
            pass
        time.sleep(self.pace)

        pad = SCRIPT_DIR / "controls-distribution.txt"
        try:
            self._dump_alles("distributiescherm")
            (SCRIPT_DIR / "controls-dialoog.txt").replace(pad)
        except Exception as e:
            log(f"uitlezing van het distributiescherm mislukt: {e}", "WARN")

        # invoervakken verzamelen (moderne laag), van boven naar beneden
        velden = []
        if uia is not None:
            try:
                for c in uia.descendants():
                    try:
                        info = c.element_info
                        ct = str(getattr(info, "control_type", "") or "").lower()
                        if ct not in ("edit", "combobox"):
                            continue
                        r = info.rectangle
                        if r.right - r.left <= 2 or r.bottom - r.top <= 2:
                            continue
                        velden.append((r.top, r.left, c))
                    except Exception:
                        continue
            except Exception:
                pass
        velden.sort(key=lambda t: (t[0], t[1]))

        # Een keuzelijst en het invoervak erin staan op dezelfde plek;
        # die tellen als één veld (het binnenste vak heeft voorrang).
        uniek = []
        for top, left, c in velden:
            dubbel = False
            for i, (t2, l2, c2) in enumerate(uniek):
                if abs(top - t2) <= 4 and abs(left - l2) <= 4:
                    ct_nieuw = str(getattr(c.element_info, "control_type", "")).lower()
                    if ct_nieuw == "edit":
                        uniek[i] = (top, left, c)
                    dubbel = True
                    break
            if not dubbel:
                uniek.append((top, left, c))
        velden = uniek

        if len(velden) < 3:
            raise BridgeStop(
                f"Distributiescherm: {len(velden)} invoervak(ken) gevonden, minimaal 3 verwacht.\n"
                f"Structuur weggeschreven naar {pad}. Maak deze ene boeking zelf af:\n"
                f"  Account {account_main}, Sub {account_sub}, Job leeg, bedrag {bedrag}"
            , na_add=True)

        # bedragveld: het vak dat het bedrag al bevat, anders het onderste
        bedrag_idx = None
        for i, (_, _, c) in enumerate(velden):
            if self._gelijk(self._lees(c), str(bedrag)):
                bedrag_idx = i
        if bedrag_idx is None:
            bedrag_idx = len(velden) - 1
        overig = [v for i, v in enumerate(velden) if i != bedrag_idx]
        volgorde = ["account_main", "account_sub", "job"][: len(overig)]
        toewijzing = dict(zip(volgorde, [v[2] for v in overig]))
        toewijzing["amount"] = velden[bedrag_idx][2]

        log("  distributiescherm: indeling afgeleid van boven naar beneden "
            f"({len(velden)} vakken; bedragvak = nr {bedrag_idx + 1})")

        # Zodra de indeling één keer is goedgekeurd, moet hij daarna precies
        # zo blijven. Wijkt het aantal vakken of de plek van het bedrag af,
        # dan is het scherm veranderd en stoppen we.
        verwacht_aantal = dcfg.get("verwacht_aantal")
        verwacht_bedrag = dcfg.get("bedrag_index")
        if dcfg.get("gekalibreerd") and verwacht_aantal is not None:
            if verwacht_aantal != len(velden) or verwacht_bedrag != bedrag_idx:
                raise BridgeStop(
                    "Het distributiescherm ziet er anders uit dan bij de goedkeuring "
                    f"({len(velden)} vakken, bedrag op nr {bedrag_idx + 1}; verwacht "
                    f"{verwacht_aantal} vakken, bedrag op nr {(verwacht_bedrag or 0) + 1}). "
                    "Gestopt vóór er iets is ingevuld.\n"
                    "Zet 'gekalibreerd' in config.json op false om opnieuw te laten kijken.",
                    na_add=True,
                )
        else:
            try:
                cfgpad = config_pad()
                cfg = json.loads(cfgpad.read_text(encoding="utf-8"))
                cfg.setdefault("distribution", {})
                cfg["distribution"]["verwacht_aantal"] = len(velden)
                cfg["distribution"]["bedrag_index"] = bedrag_idx
                cfgpad.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                log(f"kon de indeling van het distributiescherm niet opslaan: {e}", "WARN")

        def vul_ctrl(naam, ctrl, waarde):
            waarde = str(waarde)
            for strategie in self.STRATEGIEEN:
                try:
                    self._klik_in_veld(ctrl)
                    time.sleep(self.pace / 2)
                    self._voer_in(ctrl, waarde, strategie)
                    time.sleep(self.pace)
                    commit = self.cfg.get("commit_key", "{TAB}")
                    if commit:
                        ctrl.type_keys(commit, set_foreground=False)
                        time.sleep(self.pace)
                except Exception as e:
                    log(f"  {naam}: manier '{strategie}' mislukt: {e}", "WARN")
                    continue
                gelezen = self._lees(ctrl)
                if self._gelijk(gelezen, waarde):
                    log(f"  {naam:18} = {waarde}   (manier: {strategie})")
                    return
                log(f"  {naam}: manier '{strategie}' gaf '{gelezen}', verwacht '{waarde}'", "WARN")
            raise BridgeStop(
                f"Distributieveld '{naam}' laat zich niet vullen met '{waarde}'. Gestopt vóór OK.\n"
                "De kopregel staat al in Eagle — maak deze boeking zelf af of annuleer het scherm."
            , na_add=True)

        vul_ctrl("distributie account", toewijzing["account_main"], account_main)
        if "account_sub" in toewijzing:
            vul_ctrl("distributie sub", toewijzing["account_sub"], account_sub)
        # Job blijft bewust leeg.
        huidig_bedrag = self._lees(toewijzing["amount"])
        if self._gelijk(huidig_bedrag, str(bedrag)):
            log(f"  {'distributie bedrag':18} = {bedrag}   (stond al ingevuld)")
        else:
            vul_ctrl("distributie bedrag", toewijzing["amount"], bedrag)

        if not dcfg.get("gekalibreerd"):
            schermafdruk("distributie-ingevuld")
            raise BridgeStop(
                "Distributiescherm ingevuld, maar nog niet bevestigd — dit is de eerste keer.\n"
                "KIJK OP HET SCHERM: staat Account op "
                f"{account_main}, Sub op {account_sub}, Job leeg en het bedrag op {bedrag}?\n"
                "  Klopt het  -> druk zelf op OK in Eagle en meld het; daarna gaat dit vanzelf.\n"
                "  Klopt het niet -> druk Cancel en stuur controls-distribution.txt door.\n"
                f"Structuur: {pad}"
            , na_add=True)

        if not self._beantwoord(handle, {"antwoord": dcfg.get("ok_button", "OK")}):
            raise BridgeStop("Kon OK niet aanklikken in het distributiescherm — controleer Eagle.", na_add=True)
        time.sleep(self.pace * 3)

    # -- vouchernummer ---------------------------------------------------

    def lees_vouchernummer(self):
        spec = self.cfg.get("current_voucher") or {}
        if "rel" not in spec:
            return None
        try:
            c = self.zoek_op_plek(spec["parent"], spec["rel"], spec.get("tol"))
            return self._lees(c) if c is not None else None
        except Exception:
            return None


# ------------------------------------------------------------------ run

def voer_regel_in(eagle, regel, dry_run):
    velden = eagle.cfg["fields"]
    ap_main, ap_sub = regel["apAccount"]
    dist_main, dist_sub = regel["distribution"]["account"]

    waarden = {
        "trx_type": regel["trxType"],
        "voucher_date": regel["voucherDate"],
        "invoice_date": regel["invoiceDate"],
        "vendor": regel["vendor"],
        "vendor_ref_no": regel["vendorRefNo"],
        "ap_account_main": ap_main,
        "ap_account_sub": ap_sub,
        "terms_code": regel["termsCode"],
        "voucher_ref": regel["voucherRef"],
        "invoice_amount": regel["invoiceAmount"],
        # Eagle rekent Due Date alleen zelf uit als de terms code bekend is.
        # Wij zetten hem expliciet gelijk aan de factuurdatum, zodat de
        # boeking niet afhangt van wat Eagle wel of niet invult.
        "due_date": regel.get("dueDate") or regel["invoiceDate"],
        "disc_date": regel.get("discDate") or regel["invoiceDate"],
    }

    if dry_run:
        for naam in INVOERVOLGORDE:
            log(f"  [proef] {naam:18} = {waarden[naam]}")
        log("  [proef] Add F4")
        log(f"  [proef] distributie {dist_main}-{dist_sub}, Job leeg, bedrag {regel['distribution']['amount']}")
        return None

    eagle.verbind()
    for naam in INVOERVOLGORDE:
        eagle.vul(naam, velden[naam], waarden[naam])

    log("  Add F4")
    eagle.win.type_keys("{F4}")
    time.sleep(eagle.pace * 3)

    handle = eagle.verwerk_na_add()
    log("  distributiescherm gevonden")
    eagle.vul_distributie(handle, dist_main, dist_sub, regel["distribution"]["amount"])

    # na OK kan nog een melding komen; wachten tot het scherm rustig is
    einde = time.time() + 5
    while time.time() < einde and eagle._distributie_venster():
        time.sleep(0.3)

    return eagle.lees_vouchernummer()


def cmd_run(args):
    cfg, cfgpad, nieuw = laad_config()
    if nieuw:
        log(f"Nieuwe config aangemaakt: {cfgpad}", "WARN")

    pad = Path(args.batch)
    if not pad.exists():
        log(f"Batchbestand niet gevonden: {pad}", "ERROR")
        return 2
    batch = json.loads(pad.read_text(encoding="utf-8"))

    regels = batch["regels"]
    if args.limit:
        regels = regels[: args.limit]

    log("=" * 62)
    log(f"Batch      : {batch.get('batchId')}")
    log(f"Bestand    : {batch.get('bestand')}")
    log(f"Entiteit   : {batch.get('entiteit')} ({batch.get('entiteitNaam')})")
    log(f"Datum      : {batch.get('voucherDate')}")
    log(f"Rekeningen : {batch.get('apRekening')} / {batch.get('distributieRekening')}")
    log(f"Regels     : {len(regels)}" + (f" (beperkt tot {args.limit})" if args.limit else ""))
    if batch.get("handmatig"):
        log(f"Handmatig  : {len(batch['handmatig'])} regel(s) gaan NIET mee")
    log(f"Config     : {cfgpad}")
    log("=" * 62)

    ok, ontbrekend = config_is_ingevuld(cfg)
    if not ok:
        log(f"Veld '{ontbrekend}' is nog niet gekoppeld in {cfgpad}.", "ERROR")
        log("Draai eerst: py -3 eagle_bridge.py calibrate", "ERROR")
        return 3

    if args.dry_run:
        eagle = Eagle.__new__(Eagle)
        eagle.cfg = cfg
        eagle.pace = 0
    else:
        try:
            eagle = Eagle(cfg)
            eagle.verbind()
            log("Eagle gevonden op New A/P Transactions.")
        except BridgeStop as e:
            log(str(e), "ERROR")
            return 4

    al_geboekt = {} if args.negeer_ledger else geboekte_sleutels()
    if args.negeer_ledger:
        log("LET OP: --negeer-ledger actief — eerder geboekte regels worden NIET overgeslagen.", "WARN")
    gedaan = overgeslagen = 0

    for i, regel in enumerate(regels, 1):
        sleutel = regel["dedupeKey"]
        log("-" * 62)
        log(f"Regel {i}/{len(regels)} — rij {regel['rij']} — factuur {regel['vendorRefNo']} — XCG {regel['invoiceAmount']}")

        if sleutel in al_geboekt:
            eerder = al_geboekt[sleutel]
            log(f"  overgeslagen: al geboekt op {eerder.get('tijd')} (voucher {eerder.get('voucher')})")
            overgeslagen += 1
            continue

        try:
            voucher = voer_regel_in(eagle, regel, args.dry_run)
        except BridgeStop as e:
            log(str(e), "ERROR")
            if e.na_add and not args.dry_run:
                schrijf_ledger({
                    "tijd": dt.datetime.now().isoformat(timespec="seconds"),
                    "batchId": batch.get("batchId"), "rij": regel["rij"],
                    "dedupeKey": sleutel, "status": "geboekt_handmatig", "reden": str(e),
                })
                log("LET OP: de kopregel van deze boeking staat al in Eagle. Maak hem daar af of "
                    "verwijder hem. Een herstart slaat deze regel over (zie ledger).", "ERROR")
            else:
                schrijf_ledger({
                    "tijd": dt.datetime.now().isoformat(timespec="seconds"),
                    "batchId": batch.get("batchId"), "rij": regel["rij"],
                    "dedupeKey": sleutel, "status": "gestopt", "reden": str(e),
                })
            log(f"Gestopt na {gedaan} geboekte regel(s).", "ERROR")
            return 5
        except Exception:
            p = schermafdruk("onverwacht")
            log("Onverwachte fout:\n" + traceback.format_exc(), "ERROR")
            if p:
                log(f"Schermafdruk: {p}", "ERROR")
            return 6

        if not args.dry_run:
            schrijf_ledger({
                "tijd": dt.datetime.now().isoformat(timespec="seconds"),
                "batchId": batch.get("batchId"), "rij": regel["rij"],
                "dedupeKey": sleutel, "status": "geboekt", "voucher": voucher,
                "bedrag": regel["invoiceAmount"], "entiteit": batch.get("entiteit"),
            })
            log("  geboekt" + (f" — voucher {voucher}" if voucher else ""))
        gedaan += 1

    log("=" * 62)
    if args.dry_run:
        log(f"Proef klaar. {gedaan} regel(s) doorlopen — er is niets in Eagle ingevoerd.")
    else:
        log(f"Klaar. {gedaan} geboekt, {overgeslagen} overgeslagen (al eerder gedaan).")
    if batch.get("handmatig"):
        log(f"Vergeet niet: {len(batch['handmatig'])} regel(s) moeten handmatig geboekt worden.")
    log(f"Logboek: {log.path}")
    return 0


# ------------------------------------------------------------------ calibrate

def cmd_calibrate(_args):
    cfg, cfgpad, _ = laad_config()
    try:
        eagle = Eagle(cfg)
        eagle.verbind()
    except BridgeStop as e:
        log(str(e), "ERROR")
        return 4

    uit = SCRIPT_DIR / "controls.txt"
    try:
        n, e = dump_controls(eagle.win, uit, "Alle bedieningselementen in 'New A/P Transactions'.")
    except Exception as ex:
        log(f"Kon het venster niet uitlezen: {ex}", "ERROR")
        return 5

    log(f"{n} elementen gevonden, waarvan {e} invoervelden.")
    log(f"Geschreven naar: {uit}")
    log(f"Config staat in: {cfgpad}")
    ok, ontbrekend = config_is_ingevuld(cfg)
    log("Velden gekoppeld: " + ("ja" if ok else f"nee (eerste: {ontbrekend})"))
    if not ok:
        log("")
        log("Stuur controls.txt door, dan wordt config.json ingevuld.")
    try:
        os.startfile(str(uit))
    except Exception:
        pass
    return 0


# ------------------------------------------------------------------ doctor

def cmd_doctor(_args):
    log(f"Python      : {sys.version.split()[0]}  ({sys.executable})")
    log(f"Programma   : {SCRIPT_DIR}")
    log(f"Gegevens    : {APP_DIR}")
    ok = True

    try:
        import pywinauto  # noqa: F401
        log("pywinauto   : aanwezig")
    except ImportError:
        log("pywinauto   : ONTBREEKT  ->  py -3 -m pip install pywinauto", "ERROR")
        ok = False
    try:
        from PIL import ImageGrab  # noqa: F401
        log("pillow      : aanwezig")
    except ImportError:
        log("pillow      : ONTBREEKT  ->  py -3 -m pip install pillow", "WARN")

    cfg, cfgpad, nieuw = laad_config()
    log(f"config.json : {'nieuw aangemaakt' if nieuw else 'gevonden'} ({cfgpad})")
    ingevuld, ontbrekend = config_is_ingevuld(cfg)
    if ingevuld:
        log(f"velden      : gekoppeld ({len(cfg['fields'])} stuks)")
    else:
        log(f"velden      : nog niet gekoppeld (eerste: {ontbrekend})  ->  calibrate", "WARN")
        ok = False
    log("distributie : " + ("gekoppeld" if cfg["distribution"].get("gekalibreerd") else "nog niet — eerste run leest het scherm uit"))

    if ok:
        try:
            eagle = Eagle(cfg)
            eagle.verbind()
            log("Eagle       : scherm New A/P Transactions gevonden")
            log(f"schermschaal: {eagle.schaal:g}× ten opzichte van de calibratie")
            for naam in INVOERVOLGORDE:
                c = None
                try:
                    c = eagle.zoek_veld(naam, cfg["fields"][naam])
                except BridgeStop:
                    pass
                log(f"  {naam:18} : {'gevonden' if c is not None else 'NIET GEVONDEN'}",
                    "INFO" if c is not None else "ERROR")
        except BridgeStop as e:
            log("Eagle       : " + str(e).splitlines()[0], "WARN")

    log(f"ledger      : {len(geboekte_sleutels())} eerder geboekte regel(s)")
    return 0 if ok else 1


# ------------------------------------------------------------------ register

def cmd_register(_args):
    if os.name != "nt":
        log("Registreren werkt alleen op Windows.", "ERROR")
        return 1
    import winreg

    exe = sys.executable
    script = str(Path(__file__).resolve())
    commando = f'"{exe}" "{script}" run "%1"'

    def zet(pad, waarde, naam=None):
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, pad) as k:
            winreg.SetValueEx(k, naam, 0, winreg.REG_SZ, waarde)

    zet(r"Software\Classes\.eaglebatch", "EagleBridge.Batch")
    zet(r"Software\Classes\EagleBridge.Batch", "Eagle vooruitbetalingen-batch")
    zet(r"Software\Classes\EagleBridge.Batch\shell\open\command", commando)
    zet(r"Software\Classes\eagleprepay", "URL:Eagle Bridge")
    zet(r"Software\Classes\eagleprepay", "", "URL Protocol")
    zet(r"Software\Classes\eagleprepay\shell\open\command", commando)

    log("Geregistreerd:")
    log("  .eaglebatch-bestanden openen nu de Eagle Bridge")
    log("  eagleprepay:// is beschikbaar voor het dashboard")
    log(f"  commando: {commando}")
    return 0


# ------------------------------------------------------------------ main

def main():
    global log
    log = Log()

    p = argparse.ArgumentParser(description="Eagle Bridge — vooruitbetalingen Keukendepot")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor", help="controleer installatie, config en veldkoppeling")
    sub.add_parser("calibrate", help="lees het Eagle-scherm uit en schrijf controls.txt")
    sub.add_parser("register", help="koppel .eaglebatch en eagleprepay:// aan dit programma")
    r = sub.add_parser("run", help="voer een batch in Eagle in")
    r.add_argument("batch", help="pad naar het .eaglebatch-bestand")
    r.add_argument("--dry-run", action="store_true", help="toon alleen wat er getypt zou worden")
    r.add_argument("--limit", type=int, default=0, help="alleen de eerste N regels")
    r.add_argument("--negeer-ledger", action="store_true",
                   help="alleen voor testen: boek ook regels die al in het ledger staan")

    args = p.parse_args()
    handlers = {"run": cmd_run, "calibrate": cmd_calibrate, "doctor": cmd_doctor, "register": cmd_register}
    code = handlers[args.cmd](args)

    if args.cmd == "run" and sys.stdin.isatty():
        input("\nDruk op Enter om te sluiten...")
    log.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
