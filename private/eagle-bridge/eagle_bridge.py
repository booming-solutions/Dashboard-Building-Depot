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
    "niet_aanraken": ["Due Date", "Disc Date", "Check Date", "Check No"],
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
INVOERVOLGORDE = [
    "trx_type", "voucher_date", "invoice_date", "vendor", "vendor_ref_no",
    "ap_account_main", "ap_account_sub", "terms_code", "voucher_ref", "invoice_amount",
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
            if rec.get("status") == "geboekt":
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


class BridgeStop(Exception):
    """Gecontroleerd stoppen: er is niets half geboekt."""


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
        return self.win

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
        tol = self.tol if tol is None else tol
        parent = self.deelvenster(parent_id)
        prect = parent.element_info.rectangle
        doel_l, doel_t = rel

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

    def zoek_veld_alle(self, naam, spec):
        if not spec or "rel" not in spec:
            raise BridgeStop(f"Veld '{naam}' staat niet in config.json. Draai eerst 'calibrate'.")
        alle = self.zoek_alle_op_plek(spec["parent"], spec["rel"], spec.get("tol"))
        if not alle:
            raise BridgeStop(
                f"Veld '{naam}' staat niet op de verwachte plek in het Eagle-scherm.\n"
                "Waarschijnlijk is het scherm gewijzigd of staat Eagle op een andere weergave.\n"
                "Draai 'py -3 eagle_bridge.py calibrate' en stuur de nieuwe controls.txt door."
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

    def vul(self, naam, spec, waarde):
        waarde = "" if waarde is None else str(waarde)
        pogingen = int(self.cfg.get("field_retries", 2))

        for poging in range(1, pogingen + 1):
            kandidaten = self.zoek_veld_alle(naam, spec)
            doel = kandidaten[0]
            try:
                try:
                    doel.set_focus()
                except Exception:
                    doel.click_input()
                time.sleep(self.pace / 2)
                doel.type_keys("^a{DEL}", set_foreground=False)
                time.sleep(self.pace / 2)
                doel.type_keys(waarde, with_spaces=True, set_foreground=False)
                time.sleep(self.pace)
            except Exception as e:
                log(f"veld '{naam}' poging {poging} mislukt: {e}", "WARN")
                time.sleep(self.pace)
                continue

            # Opnieuw opzoeken en ALLE elementen op die plek uitlezen: bij
            # keuzevelden zit de waarde in een ander omhulsel dan waar we in
            # typen. De eerste niet-lege waarde telt.
            gelezen, gezien = "", []
            for c in self.zoek_veld_alle(naam, spec):
                v = self._lees(c)
                gezien.append(v)
                if v and not gelezen:
                    gelezen = v

            if self._gelijk(gelezen, waarde):
                log(f"  {naam:18} = {waarde}")
                return True

            log(f"veld '{naam}' poging {poging}: gelezen '{gelezen}', verwacht '{waarde}' "
                f"(alles op die plek: {gezien})", "WARN")
            time.sleep(self.pace)

        raise BridgeStop(
            f"Veld '{naam}' bleef afwijken: verwacht '{waarde}'.\n"
            "Er is niets geboekt. Controleer of iemand in Eagle heeft geklikt tijdens het draaien."
        )

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

    def open_dialoog(self):
        try:
            for w in self.desktop.windows():
                try:
                    titel = (w.window_text() or "")
                except Exception:
                    continue
                if "A/P Add New Transaction" in titel or "dd distribution" in titel:
                    return w
        except Exception:
            pass
        return None

    @staticmethod
    def dialoogtekst(w):
        stukken = []
        try:
            stukken.append(w.window_text() or "")
        except Exception:
            pass
        try:
            for c in w.descendants():
                try:
                    t = c.window_text()
                    if t:
                        stukken.append(t)
                except Exception:
                    continue
        except Exception:
            pass
        return " ".join(stukken).lower()

    def handel_dialogen_af(self, max_rondes=8):
        wacht = float(self.cfg.get("dialog_wait_seconds", 8.0))
        for _ in range(max_rondes):
            einde = time.time() + wacht
            dlg = None
            while time.time() < einde:
                dlg = self.open_dialoog()
                if dlg is not None:
                    break
                time.sleep(0.2)
            if dlg is None:
                return

            tekst = self.dialoogtekst(dlg)
            if "distribution" in tekst:
                return  # apart afgehandeld

            geraakt = None
            for regel in BEKENDE_DIALOGEN:
                if regel["bevat"] in tekst:
                    geraakt = regel
                    break

            if geraakt is None:
                pad = schermafdruk("onbekend-dialoog")
                raise BridgeStop(
                    "Onbekend venster in Eagle — gestopt zonder te raden.\n"
                    f"Tekst: {tekst[:300]}\n" + (f"Schermafdruk: {pad}\n" if pad else "")
                )
            if geraakt["antwoord"] == "STOP":
                pad = schermafdruk("blokkade")
                raise BridgeStop(geraakt["uitleg"] + (f"\nSchermafdruk: {pad}" if pad else ""))

            log(f"  dialoog: {geraakt['antwoord']} — {geraakt['uitleg']}")
            try:
                dlg.child_window(title=geraakt["antwoord"], control_type="Button").click_input()
            except Exception:
                dlg.type_keys("%y" if geraakt["antwoord"].lower() == "yes" else "{ENTER}")
            time.sleep(self.pace * 2)

    # -- distributie -----------------------------------------------------

    def wacht_op_distributie(self):
        dcfg = self.cfg["distribution"]
        einde = time.time() + float(self.cfg.get("dialog_wait_seconds", 8.0))
        while time.time() < einde:
            try:
                kandidaat = self.desktop.window(title_re=dcfg["window_title_re"])
                if kandidaat.exists():
                    return kandidaat
            except Exception:
                pass
            time.sleep(0.2)
        return None

    def vul_distributie(self, account_main, account_sub, bedrag):
        dcfg = self.cfg["distribution"]
        dlg = self.wacht_op_distributie()
        if dlg is None:
            pad = schermafdruk("geen-distributie")
            raise BridgeStop(
                "Het scherm 'Add distribution' verscheen niet na Add F4.\n"
                "De kopregel kan al aangemaakt zijn — controleer dit in Eagle vóór je opnieuw start."
                + (f"\nSchermafdruk: {pad}" if pad else "")
            )

        dlg.set_focus()
        time.sleep(self.pace)

        # Eerste keer: alleen uitlezen en stoppen. Zo wordt er nooit
        # geraden in een scherm dat nog niet gekoppeld is.
        if not dcfg.get("gekalibreerd"):
            pad = SCRIPT_DIR / "controls-distribution.txt"
            n, e = dump_controls(dlg, pad, "Alle bedieningselementen in 'Add distribution'.")
            schermafdruk("distributie-eerste-keer")
            raise BridgeStop(
                "Het distributiescherm is nog niet gekoppeld — gestopt vóór er iets is ingevuld.\n"
                f"{n} elementen ({e} invoervelden) weggeschreven naar:\n  {pad}\n\n"
                "Deze ene boeking maak je zelf af in Eagle:\n"
                f"  Account Number {account_main}, Sub {account_sub}, Job leeg, bedrag {bedrag}\n\n"
                "Stuur daarna controls-distribution.txt door; daarna gaat dit vanzelf."
            )

        try:
            edits = [c for c in dlg.descendants()
                     if str(getattr(c.element_info, "control_type", "")).lower().startswith("edit")]
        except Exception:
            edits = []

        def pak(spec, naam):
            i = spec.get("index")
            if i is None or i >= len(edits):
                raise BridgeStop(
                    f"Distributieveld '{naam}' niet gevonden (index {i}, {len(edits)} velden aanwezig).\n"
                    "Draai het opnieuw met gekalibreerd=false in config.json om het scherm uit te lezen."
                )
            return edits[i]

        for naam, spec, waarde in [
            ("distributie account", dcfg["account_main"], account_main),
            ("distributie sub", dcfg["account_sub"], account_sub),
            ("distributie bedrag", dcfg["amount"], bedrag),
        ]:
            veld = pak(spec, naam)
            veld.set_focus()
            time.sleep(self.pace / 2)
            veld.type_keys("^a{DEL}", set_foreground=False)
            veld.type_keys(str(waarde), with_spaces=True, set_foreground=False)
            time.sleep(self.pace)
            gelezen = self._lees(veld)
            if not self._gelijk(gelezen, str(waarde)):
                pad = schermafdruk("distributie-afwijking")
                raise BridgeStop(
                    f"{naam}: gelezen '{gelezen}', verwacht '{waarde}'. Gestopt.\n"
                    "De kopregel staat al in Eagle — maak deze boeking handmatig af."
                    + (f"\nSchermafdruk: {pad}" if pad else "")
                )
            log(f"  {naam:18} = {waarde}")

        try:
            dlg.child_window(title=dcfg.get("ok_button", "OK"), control_type="Button").click_input()
        except Exception:
            dlg.type_keys("{ENTER}")
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

    eagle.handel_dialogen_af()
    eagle.vul_distributie(dist_main, dist_sub, regel["distribution"]["amount"])
    eagle.handel_dialogen_af()

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

    al_geboekt = geboekte_sleutels()
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

    args = p.parse_args()
    handlers = {"run": cmd_run, "calibrate": cmd_calibrate, "doctor": cmd_doctor, "register": cmd_register}
    code = handlers[args.cmd](args)

    if args.cmd == "run" and sys.stdin.isatty():
        input("\nDruk op Enter om te sluiten...")
    log.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
