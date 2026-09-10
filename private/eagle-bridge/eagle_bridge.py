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
  py -3 eagle_bridge.py run "eagleprepay://batch/<id>?t=<token>&h=boomingsolutions.ai"
  py -3 eagle_bridge.py register

KOPPELING MET HET DASHBOARD
  Het dashboard slaat een batch op en opent eagleprepay://batch/<id>.
  Windows start daarmee deze Bridge (na 'register'). De Bridge haalt de
  batch op via https://<h>/api/finance/prepay/batch/<id>?t=<token> en
  meldt elke stap terug op .../voortgang, zodat het dashboard de
  voortgang live toont. Het token hoort bij die ene batch; er staat
  niets geheims op de PC. Zonder netwerk boekt de Bridge gewoon door;
  het terugmelden mislukt dan stil (WARN in het logboek).

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
import threading
import queue
import socket
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path

BRIDGE_VERSIE = "2026.09.10"

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = Path(os.environ.get("APPDATA", Path.home())) / "EagleBridge"
LEDGER_PATH = APP_DIR / "ledger.jsonl"
LOG_DIR = APP_DIR / "logs"
SHOT_DIR = SCRIPT_DIR / "screenshots"   # naast het script, zodat ze meteen te bekijken zijn


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
        r = RAPPORTEUR
        if r is not None:
            try:
                r.log_regel(str(msg), level)
            except Exception:
                pass

    def close(self):
        try:
            self.fh.close()
        except Exception:
            pass


log = None
RAPPORTEUR = None


# ------------------------------------------------------------------ rapporteur
#
# Meldt de voortgang terug aan het dashboard, zodat de gebruiker daar
# elke stap ziet. Draait in een eigen thread met een wachtrij, zodat het
# typen in Eagle er nooit op hoeft te wachten. Mislukt het versturen,
# dan gaat het boeken gewoon door; het ledger op de PC blijft leidend.

class Rapporteur:
    def __init__(self, host, batch_uuid, token):
        self.host = host
        self.id = batch_uuid
        self.token = token
        self.url = f"{schema_van(host)}://{host}/api/finance/prepay/batch/{batch_uuid}/voortgang"
        self.q = queue.Queue()
        self.rij = None            # regel waar we nu mee bezig zijn
        self.mislukt = 0
        self.gemeld = False
        self.stop = threading.Event()
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()

    # -- wat er gemeld wordt --------------------------------------------
    def event(self, bericht, niveau="INFO", rij=None):
        self.q.put(("event", {"rij": rij if rij is not None else self.rij, "niveau": niveau,
                              "bericht": bericht, "tijd": dt.datetime.now().astimezone().isoformat()}))

    def log_regel(self, msg, level):
        # elke logregel wordt een gebeurtenis; INFO-regels binnen een
        # regel worden ook de 'stap' van die regel
        self.event(msg, level)
        if self.rij is not None and level == "INFO":
            stap = msg.strip()
            if stap and not stap.startswith(("=", "-")):
                self.regel(self.rij, stap=stap[:120])

    def regel(self, rij, **velden):
        self.q.put(("row", {"rij": rij, **velden}))

    def batch(self, **velden):
        self.q.put(("batch", velden))

    def start_regel(self, rij):
        self.rij = rij
        self.regel(rij, status="bezig", stap="gestart")

    def einde_regel(self):
        self.rij = None

    # -- versturen ---------------------------------------------------------
    def _loop(self):
        while not self.stop.is_set() or not self.q.empty():
            items = []
            try:
                items.append(self.q.get(timeout=0.8))
            except queue.Empty:
                continue
            # alles wat er nog ligt in dezelfde zending meenemen
            try:
                while len(items) < 200:
                    items.append(self.q.get_nowait())
            except queue.Empty:
                pass
            self._verstuur(items)

    def _verstuur(self, items):
        body = {"events": [], "rows": [], "batch": {}}
        rijen = {}
        for soort, d in items:
            if soort == "event":
                body["events"].append(d)
            elif soort == "row":
                r = rijen.setdefault(d["rij"], {"rij": d["rij"]})
                r.update({k: v for k, v in d.items() if k != "rij"})
            elif soort == "batch":
                body["batch"].update(d)
        body["rows"] = list(rijen.values())
        if not body["batch"]:
            del body["batch"]
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.url, data=data, method="POST", headers={
            "Content-Type": "application/json", "x-batch-token": self.token,
            "User-Agent": f"EagleBridge/{BRIDGE_VERSIE}",
        })
        for poging in range(3):
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    resp.read()
                self.mislukt = 0
                return
            except Exception as e:
                fout = e
                time.sleep(1.5 * (poging + 1))
        self.mislukt += 1
        if not self.gemeld:
            self.gemeld = True
            try:
                print(f"{dt.datetime.now().strftime('%H:%M:%S')} WARN  terugmelden aan het dashboard mislukt "
                      f"({fout}); het boeken gaat door, kijk in het logboek op de PC.", flush=True)
            except Exception:
                pass

    def sluit(self, wacht=8.0):
        self.stop.set()
        self.t.join(timeout=wacht)


def haal_batch_op(host, batch_uuid, token):
    """Haalt de batch op bij het dashboard (GET .../batch/<id>?t=<token>)."""
    url = f"{schema_van(host)}://{host}/api/finance/prepay/batch/{batch_uuid}?t={urllib.parse.quote(token)}"
    req = urllib.request.Request(url, headers={"User-Agent": f"EagleBridge/{BRIDGE_VERSIE}"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            j = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            tekst = json.loads(e.read().decode("utf-8")).get("error")
        except Exception:
            tekst = None
        raise BridgeStop(f"Batch ophalen bij {host} mislukt: HTTP {e.code}{(' — ' + tekst) if tekst else ''}.")
    except Exception as e:
        raise BridgeStop(f"Batch ophalen bij {host} mislukt: {e}\nIs er internet op deze PC?")
    if not j.get("ok") or not isinstance(j.get("payload"), dict):
        raise BridgeStop(f"Batch ophalen bij {host} gaf een onverwacht antwoord: {j.get('error') or j}")
    payload = j["payload"]
    payload["rapportage"] = {"id": batch_uuid, "token": token, "host": host}
    return payload


TOEGESTANE_HOSTS = ("boomingsolutions.ai", "www.boomingsolutions.ai", ".vercel.app", "localhost:3000", "127.0.0.1:3000")


def schema_van(host):
    """Alleen lokaal ontwikkelen gaat over http; alles daarbuiten over https."""
    return "http" if str(host).startswith(("localhost", "127.0.0.1")) else "https"


def host_toegestaan(host):
    h = (host or "").lower()
    return any(h == t or (t.startswith(".") and h.endswith(t)) for t in TOEGESTANE_HOSTS)


def ontleed_startlink(link):
    """eagleprepay://batch/<id>?t=<token>&h=<host>  ->  (host, id, token)"""
    u = urllib.parse.urlparse(link)
    delen = [p for p in (u.netloc + u.path).split("/") if p]
    if len(delen) < 2 or delen[0] != "batch":
        raise BridgeStop(f"Onbekende startlink: {link}")
    qs = urllib.parse.parse_qs(u.query)
    token = (qs.get("t") or [""])[0]
    host = (qs.get("h") or ["boomingsolutions.ai"])[0]
    if not token:
        raise BridgeStop("De startlink bevat geen token.")
    if not host_toegestaan(host):
        raise BridgeStop(f"De startlink verwijst naar een onbekende server ('{host}') — geweigerd.")
    return host, delen[1], token


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


def tekstregel_masker(afbeelding, drempel=90):
    """
    Zwart-witmasker van de vraagtekst in een Eagle-melding.

    Neemt de band tussen titelbalk en knoppen, houdt alleen donkere
    beeldpunten over (de tekst; het lichte TRAINING-watermerk valt weg),
    snijdt strak bij op de tekst en schaalt naar een vaste grootte. Zo is
    de vergelijking onafhankelijk van schermschaal, vensterpositie en
    watermerk, en gevoelig voor de tekst zelf.
    """
    from PIL import Image
    g = afbeelding.convert("L")
    w, h = g.size
    band = g.crop((int(w * 0.03), int(h * 0.18), int(w * 0.97), int(h * 0.62)))
    m = band.point(lambda v: 255 if v < drempel else 0)
    bw, bh = m.size
    px = m.load()
    cols = [sum(1 for y in range(bh) if px[x, y]) for x in range(bw)]
    rows = [sum(1 for x in range(bw) if px[x, y]) for y in range(bh)]
    minc, minr = max(1, bh // 12), max(1, bw // 60)
    xs = [x for x, c in enumerate(cols) if c >= minc]
    ys = [y for y, r in enumerate(rows) if r >= minr]
    if not xs or not ys:
        return None
    return (m.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1))
             .resize((240, 24), Image.LANCZOS)
             .point(lambda v: 255 if v > 100 else 0))


def tekstverschil(a, b, schuif=3):
    """
    Aandeel afwijkende beeldpunten tussen twee tekstmaskers
    (0 = gelijk, 1 = niets gemeen).

    Verschuivingstolerant: hetzelfde venster op een andere schermschaal
    levert een masker op dat een paar beeldpunten verschoven kan zijn
    (gemeten: 0,18 zonder, 0,07 mét tolerantie), terwijl een venster met
    andere tekst ruim boven 0,25 blijft. De maskers worden eerst iets
    verdikt en daarna over kleine verschuivingen vergeleken; de kleinste
    afwijking telt.
    """
    from PIL import ImageFilter
    ma, mb = tekstregel_masker(a), tekstregel_masker(b)
    if ma is None or mb is None:
        return 1.0
    ma = ma.filter(ImageFilter.MaxFilter(3))
    mb = mb.filter(ImageFilter.MaxFilter(3))
    w, h = ma.size
    pa, pb = ma.load(), mb.load()
    beste = 1.0
    for dx in range(-schuif, schuif + 1):
        for dy in range(-2, 3):
            n = t = 0
            for y in range(h):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for x in range(w):
                    xx = x + dx
                    if xx < 0 or xx >= w:
                        continue
                    t += 1
                    if (pa[x, y] > 0) != (pb[xx, yy] > 0):
                        n += 1
            if t:
                beste = min(beste, n / t)
    return beste


def referentiebeelden(regel):
    """Alle referentiebeelden van een bekend venster: 'bestand' en/of lijst 'bestanden'."""
    namen = []
    if regel.get("bestand"):
        namen.append(regel["bestand"])
    for n in regel.get("bestanden") or []:
        if n and n not in namen:
            namen.append(n)
    return namen


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

    # -- store-controle ----------------------------------------------------
    #
    # De titelbalk van het scherm zegt op welke store Eagle staat:
    #   "New A/P Transactions - Store: 1  BUILDING DEPOT B.V.  Terminal: 331  Signed On User: JBOOM"
    # Curaçao (entiteit 000) = Store 1, Bonaire (700) = Store B. Een batch
    # voor de ene entiteit mag NOOIT op de store van de andere geboekt
    # worden; dat wordt hier hard afgedwongen, vóór er iets getypt wordt.

    def eagle_titel(self):
        try:
            return self.win.window_text() or ""
        except Exception:
            return ""

    def eagle_store(self):
        m = re.search(r"Store:\s*([A-Za-z0-9]+)", self.eagle_titel())
        return m.group(1).upper() if m else None

    def eagle_gebruiker(self):
        m = re.search(r"Signed On User:\s*(\S+)", self.eagle_titel())
        return m.group(1) if m else None

    def controleer_store(self, entiteit):
        stores = self.cfg.get("stores") or {"000": "1", "700": "B"}
        namen = {"000": "Curaçao", "700": "Bonaire"}
        verwacht = str(stores.get(str(entiteit), "")).upper()
        gezien = self.eagle_store()
        if not verwacht:
            raise BridgeStop(f"Onbekende entiteit '{entiteit}' in de batch — geen store bekend (config.json: stores).")
        if gezien is None:
            raise BridgeStop(
                "Kan niet zien op welke store Eagle staat (geen 'Store:' in de titelbalk):\n"
                f"  '{self.eagle_titel()}'\nEr is niets geboekt."
            )
        if gezien != verwacht:
            andere = [e for e, s in stores.items() if str(s).upper() == gezien]
            raise BridgeStop(
                "STOP — VERKEERDE STORE.\n"
                f"  Deze batch is voor {namen.get(str(entiteit), entiteit)} (entiteit {entiteit}) en hoort op Store {verwacht}.\n"
                f"  Eagle staat nu op Store {gezien}"
                + (f" ({namen.get(andere[0], andere[0])})" if andere else "") + ".\n"
                "  Zet Eagle op de juiste store en start de batch opnieuw. Er is niets geboekt."
            )
        log(f"Store-controle: Eagle staat op Store {gezien} = {namen.get(str(entiteit), entiteit)} "
            f"(entiteit {entiteit}) — klopt. Gebruiker: {self.eagle_gebruiker() or '?'}")
        return gezien

    SCHALEN =[1.0, 1.25, 0.8, 1.5, 0.6667, 1.75, 0.5714, 2.0, 0.5, 1.2, 0.8333, 1.4, 0.7143, 1.6, 0.625]

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
    STRATEGIEEN = ["selectie", "keuzelijst", "cijfers_wis", "cijfers_home", "settext", "settext_cijfers"]

    # -- tekst in een keuzevak krijgen ----------------------------------
    #
    # Toetsaanslagen in Eagle's keuzevakken zijn onbetrouwbaar: een
    # herhaalde toets valt weg ('2099-000' werd '209-000'), ook met pauzes.
    # Daarom gaat de tekst in één keer via het klembord naar binnen
    # (Ctrl+A, Ctrl+V — zoals plakken met de hand), en wordt hij daarna
    # teruggelezen. Pas als het klembord niet werkt, wordt er toets voor
    # toets getypt, waarbij na elke toets wordt gekeken of hij is
    # aangekomen en zo niet, opnieuw wordt gestuurd.

    @staticmethod
    def _klembord_zet(tekst):
        import win32clipboard, win32con
        for _ in range(5):
            try:
                win32clipboard.OpenClipboard()
                try:
                    win32clipboard.EmptyClipboard()
                    win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, tekst)
                finally:
                    win32clipboard.CloseClipboard()
                return True
            except Exception:
                time.sleep(0.1)
        return False

    def _tekst_klopt(self, gelezen, waarde):
        g = (gelezen or "").replace(" ", "").upper()
        v = waarde.replace(" ", "").upper()
        return bool(g) and (g == v or g.startswith(v) or self._gelijk(gelezen, waarde))

    def _zet_tekst_in_keuzevak(self, doel, waarde):
        from pywinauto import keyboard
        pauze = self.pace / 2

        # 1. Plakken via het klembord: de hele waarde in één keer.
        if self._klembord_zet(waarde):
            keyboard.send_keys("^a")
            time.sleep(pauze)
            keyboard.send_keys("^v")
            time.sleep(self.pace)
            gelezen = self._lees(doel)
            if self._tekst_klopt(gelezen, waarde):
                log(f"  keuzelijst: '{waarde}' geplakt (leest '{gelezen}')")
                return True
            if not gelezen:
                # Niet terug te lezen zolang de lijst open staat; plakken is
                # deterministisch, dus we vertrouwen erop.
                log(f"  keuzelijst: '{waarde}' geplakt (vak niet terug te lezen)")
                return True
            log(f"  keuzelijst: plakken gaf '{gelezen}' in plaats van '{waarde}' — nu toets voor toets", "WARN")
        else:
            log("  keuzelijst: klembord niet beschikbaar — toets voor toets", "WARN")

        # 2. Toets voor toets, met controle na elke toets.
        keyboard.send_keys("^a{DEL}")
        time.sleep(pauze)
        for poging in range(3):
            fout = False
            for i, ch in enumerate(waarde):
                verwacht = waarde[: i + 1]
                for herhaal in range(3):
                    keyboard.send_keys(ch if ch != " " else "{SPACE}", pause=0.05)
                    time.sleep(0.12)
                    gelezen = self._lees(doel)
                    if not gelezen or self._tekst_klopt(gelezen, verwacht):
                        break
                    if len(gelezen) > len(verwacht):
                        # Te veel tekens (bijv. automatische aanvulling): wis en begin opnieuw.
                        fout = True
                        break
                    log(f"  keuzelijst: toets '{ch}' niet aangekomen (leest '{gelezen}') — opnieuw", "WARN")
                if fout:
                    break
            gelezen = self._lees(doel)
            if not gelezen or self._tekst_klopt(gelezen, waarde):
                log(f"  keuzelijst: '{waarde}' getypt (leest '{gelezen}')")
                return True
            log(f"  keuzelijst: poging {poging + 1} gaf '{gelezen}' in plaats van '{waarde}' — wissen en opnieuw", "WARN")
            keyboard.send_keys("^a{DEL}")
            time.sleep(pauze)
        raise BridgeStop(f"Kreeg '{waarde}' niet in het keuzevak (laatst gelezen: '{self._lees(doel)}').")

    def _voer_in(self, doel, waarde, strategie, kandidaten=None, enter_aantal=1, plakken=False):
        cijfers = re.sub(r"\D", "", waarde)
        pauze = self.pace / 2

        if strategie == "keuzelijst":
            # plakken=False (kopscherm: Trx Type, Vendor, Terms Code): de
            # bewezen manier — pijltje, waarde typen, Enter, Tab. NIET wijzigen.
            # plakken=True (alleen het distributiescherm, Account Number):
            # de waarde gaat via het klembord naar binnen, met terugleescontrole.
            # Zoals een mens het doet bij een keuzeveld: op het pijltje klikken
            # zodat de lijst opent, de waarde typen, en met Enter kiezen. Pas
            # dan koppelt Eagle de waarde (leveranciersnaam verschijnt, Remit To
            # wordt gevuld). Typen + Tab laat het vak "not on file".
            # Sommige keuzevakken (Account Number in het distributiescherm)
            # hebben twee keer Enter nodig voordat Eagle de omschrijving erbij
            # zoekt ("Clearing Account Payments"): enter_aantal.
            from pywinauto import keyboard
            houder = doel
            for c in (kandidaten or []):
                try:
                    if c.rectangle().width() > houder.rectangle().width():
                        houder = c
                except Exception:
                    continue
            r = houder.rectangle()
            houder.click_input(coords=(max(4, r.width() - 8), r.height() // 2))
            time.sleep(self.pace)
            if plakken:
                self._zet_tekst_in_keuzevak(doel, waarde)
            else:
                # Typen zoals altijd; daarna één keer kijken wat er in het vak
                # staat. Eagle laat soms toetsen vallen ('4741' werd '4').
                # Klopt het niet, dan wissen en langzamer opnieuw typen.
                # Is het vak niet uit te lezen (Trx Type), dan gebeurt er
                # niets extra's.
                for poging in range(3):
                    keyboard.send_keys(waarde, with_spaces=True, pause=0.05 * (poging + 1))
                    time.sleep(pauze)
                    getypt = self._lees(doel)
                    if not getypt or self._tekst_klopt(getypt, waarde):
                        break
                    log(f"  keuzelijst: getypt '{getypt}' in plaats van '{waarde}' — wissen en opnieuw", "WARN")
                    keyboard.send_keys("^a{DEL}")
                    time.sleep(pauze)
            for _ in range(max(1, int(enter_aantal or 1))):
                keyboard.send_keys("{ENTER}")
                time.sleep(pauze if not plakken else self.pace)
            # Het keuzevak houdt na Enter de focus; met Tab laten we het los,
            # anders belandt de invoer van het volgende veld hierin.
            keyboard.send_keys("{TAB}")
            return

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
        basis = list(self.STRATEGIEEN)
        if spec.get("soort") != "keuzelijst":
            basis = [x for x in basis if x != "keuzelijst"]   # nooit een lijst openen bij een gewoon vak
        volgorde = ([vast] + [x for x in basis if x != vast]) if vast else basis

        laatste = ""
        for strategie in volgorde:
            kandidaten = self.zoek_veld_alle(naam, spec)
            doel = kandidaten[0]
            try:
                if strategie != "keuzelijst":
                    self._klik_in_veld(doel)
                    time.sleep(self.pace / 2)
                self._voer_in(doel, waarde, strategie, kandidaten,
                              enter_aantal=spec.get("enter_aantal", 1))
                time.sleep(self.pace)

                # Bevestigen. Eagle valideert keuzevelden pas bij het verlaten
                # van het veld: zonder dit blijft er "not on file" staan.
                # Bij 'keuzelijst' heeft Enter dat al gedaan.
                commit = spec.get("commit", self.cfg.get("commit_key", "{TAB}"))
                if commit and strategie != "keuzelijst":
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

            # Extra bewijs dat Eagle de waarde echt gekoppeld heeft: een ander
            # veld dat dan gevuld moet zijn (bij Vendor: Remit To).
            controle = spec.get("controle")
            if controle and self._gelijk(gelezen, waarde):
                ctrl_gelezen, _ = self._lees_veld(f"{naam}-controle", controle)
                verwacht = controle.get("verwacht", "zelfde")
                ok = (self._gelijk(ctrl_gelezen, waarde) if verwacht == "zelfde" else bool(ctrl_gelezen))
                if not ok:
                    log(f"veld '{naam}': waarde staat er ('{gelezen}'), maar {controle.get('_veld','controleveld')} "
                        f"is '{ctrl_gelezen}' — Eagle heeft de waarde niet gekoppeld; volgende manier", "WARN")
                    gelezen = ""

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
                        try:
                            if not c.is_visible():
                                continue  # verborgen knop van het generieke formulier
                        except Exception:
                            pass
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
            if self._heeft_invoervakken(handle) >= 2:
                continue  # dat is een invoerscherm, geen melding
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

    def _heeft_invoervakken(self, handle):
        """Telt invoervakken in een venster (tekstvakken en keuzelijsten)."""
        n = 0
        uia, w32 = self._wrap_beide(handle)
        for bron in (w32, uia):
            if bron is None:
                continue
            try:
                for c in bron.descendants():
                    try:
                        cls = (c.element_info.class_name or "").lower()
                        ct = str(getattr(c.element_info, "control_type", "") or "").lower()
                        if "textbox" in cls or "comboedit" in cls or ct in ("edit", "combobox"):
                            r = c.element_info.rectangle
                            if r.right - r.left > 10 and r.bottom - r.top > 8:
                                n += 1
                    except Exception:
                        continue
            except Exception:
                continue
            if n:
                break
        return n

    def _distributie_venster(self):
        """
        Zoekt het distributiescherm.

        Op titel ('Add distribution'), en anders: een Eagle-formulier
        (ThunderRT6FormDC) dat niet het hoofdscherm is en invoervakken bevat —
        het distributiescherm blijkt hetzelfde generieke formulier te zijn als
        het meldingsvenster, met dezelfde titel, maar mét invoervakken.
        """
        hoofd = self._handle_van(self.win) if self.win is not None else None

        # 1. Als kindvenster ín het A/P-scherm (zo toont Eagle het: een
        #    venster 'Add distribution' binnen de werkruimte).
        if self.win is not None:
            try:
                for c in self.win.descendants():
                    try:
                        info = c.element_info
                        if "add distribution" in (info.name or "").lower() and \
                           "form" in (info.class_name or "").lower():
                            h = self._handle_van(c)
                            if h:
                                return h
                    except Exception:
                        continue
            except Exception:
                pass

        # 2. Als los venster.
        for handle, titel, klasse, rect in self._zichtbare_vensters():
            t = (titel or "").lower()
            if "add distribution" in t:
                return handle
        for handle, titel, klasse, rect in self._zichtbare_vensters():
            if handle == hoofd:
                continue
            if "thunderrt6form" not in (klasse or "").lower():
                continue
            if rect.right - rect.left < 200 or rect.bottom - rect.top < 100:
                continue
            if self._heeft_invoervakken(handle) >= 2:
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
                try:
                    rect = (w32 or uia).rectangle()
                except Exception:
                    return False
                knoppen = self._knoppen_in(handle, rect)
                if not knoppen:
                    log("    geen knoppen gevonden binnen het venster", "WARN")
                    return False
                keuze = regel["knop"]
                if keuze == "eerste":            # bovenste (en meest linkse) knop, bijv. OK
                    rij = list(knoppen)
                    c = rij[0][0]
                elif keuze == "laatste":
                    rij = list(knoppen)
                    c = rij[-1][0]
                else:
                    # alleen de onderste rij knoppen telt
                    onderste = max(k[1].top for k in knoppen)
                    rij = [k for k in knoppen if abs(k[1].top - onderste) < 6]
                    rij.sort(key=lambda k: k[1].left)
                    if keuze == "links":
                        c = rij[0][0]
                    elif keuze == "rechts":
                        c = rij[-1][0]
                    else:
                        c = rij[int(keuze)][0]
                r = c.element_info.rectangle
                try:
                    (w32 or uia).set_focus()
                    time.sleep(0.2)
                except Exception:
                    pass
                log(f"    {len(rij)} knop(pen) in de onderste rij; klik op '{keuze}' "
                    f"= ({(r.left + r.right) // 2},{(r.top + r.bottom) // 2})")
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
        # Enter alleen als laatste reserve: bij Eagle-meldingen is niet zeker
        # welke knop de standaardknop is (Enter bleek hier vermoedelijk 'No').
        if doel in ("yes", "ok") and regel.get("enter", False):
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
        drempel = float(self.cfg.get("beeld_drempel", 0.15))
        for v in vensters:
            if v["beeld"] is None:
                continue
            huidig = v["beeld"]
            beste, beste_score = None, 999.0
            for regel in bekend:
                if regel.get("titel", "").lower() not in v["titel"].lower():
                    continue
                # Vorm: verhouding breedte/hoogte (schaalonafhankelijk).
                b, h = regel.get("breedte"), regel.get("hoogte")
                if b and h and v["hoogte"]:
                    afw = abs((v["breedte"] / v["hoogte"]) - (b / h)) / (b / h)
                    if afw > 0.12:
                        log(f"  '{regel['naam']}': verhouding wijkt af ({v['breedte']}x{v['hoogte']} "
                            f"vs {b}x{h}, {afw:.0%})", "WARN")
                        continue
                if regel.get("knoppen") is not None and regel["knoppen"] != len(v["knoppen"]):
                    log(f"  '{regel['naam']}': {len(v['knoppen'])} knop(pen) gezien, {regel['knoppen']} verwacht "
                        "— telt niet mee als afwijzing", "WARN")
                paden = [SCRIPT_DIR / "dialogen" / n for n in referentiebeelden(regel)]
                paden_aanwezig = [p for p in paden if p.exists()]
                if paden and not paden_aanwezig:
                    # Eerste keer: de vorm klopt, er is nog geen referentiebeeld.
                    # Dit beeld wordt de referentie; daarna moet ook het beeld kloppen.
                    pad = paden[0]
                    try:
                        pad.parent.mkdir(parents=True, exist_ok=True)
                        v["beeld"].save(pad)
                        log(f"  venster op vorm herkend als '{regel['naam']}' — beeld vastgelegd als "
                            f"referentie: {pad.name}")
                    except Exception as e:
                        log(f"kon referentiebeeld niet opslaan: {e}", "WARN")
                    return regel, v
                # Meerdere referentiebeelden (bijv. per schermschaal): de beste telt.
                score = 999.0
                for pad in paden_aanwezig:
                    try:
                        score = min(score, tekstverschil(huidig, Image.open(pad)))
                    except Exception as e:
                        log(f"vergelijken met {pad.name} mislukt: {e}", "WARN")
                if score >= 999.0:
                    continue
                if score < beste_score:
                    beste, beste_score = regel, score
            if beste is not None and beste_score <= drempel:
                log(f"  venster herkend op tekstbeeld: '{beste['naam']}' (afwijking {beste_score:.2f})")
                return beste, v
            if beste is not None:
                log(f"  dichtstbijzijnde bekende venster '{beste['naam']}' wijkt te veel af "
                    f"({beste_score:.2f} > {drempel})", "WARN")
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
        wacht = float(self.cfg.get("dialog_wait_seconds", 8.0)) * 2
        tweede_f4_gedaan = False

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

                # Na de melding staat Eagle weer op het invoerscherm. Het
                # distributiescherm komt niet vanzelf: daarvoor moet je
                # NOGMAALS op F4 drukken. Eerst even kijken of het er toch al
                # is (bijvoorbeeld na een tweede melding), anders F4.
                if regel.get("f4_daarna", True) and not tweede_f4_gedaan:
                    even = time.time() + 3
                    while time.time() < even and not self._distributie_venster():
                        time.sleep(0.3)
                    if not self._distributie_venster():
                        log("  Add F4 (nogmaals, voor het distributiescherm)")
                        try:
                            self.win.set_focus()
                            time.sleep(self.pace)
                            self.win.type_keys("{F4}", set_foreground=True)
                        except Exception as e:
                            raise BridgeStop(f"Tweede F4 voor het distributiescherm mislukt: {e}", na_add=True)
                        tweede_f4_gedaan = True
                        time.sleep(self.pace * 3)
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

        # Indeling van boven naar beneden: Account Number, Job, Distribution Amount.
        # Het bedragvak is het vak dat het bedrag al bevat, anders het onderste.
        bedrag_idx = None
        for i, (_, _, c) in enumerate(velden):
            if self._gelijk(self._lees(c), str(bedrag)):
                bedrag_idx = i
        if bedrag_idx is None:
            bedrag_idx = len(velden) - 1
        overig = [v for i, v in enumerate(velden) if i != bedrag_idx]
        toewijzing = {"account": overig[0][2], "amount": velden[bedrag_idx][2]}
        if len(overig) > 1:
            toewijzing["job"] = overig[1][2]   # blijft leeg

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

        # Rekening: één vak voor hoofdrekening én entiteit. Het formaat staat
        # in config.json (account_formaat); standaard "2099" bij entiteit 000
        # en "2099-700" bij een andere entiteit.
        # Altijd voluit: '2099-000' of '2099-700'. Alleen '2099' geeft "Account not on file".
        formaat = dcfg.get("account_formaat") or "{main}-{sub}"
        account_waarde = formaat.format(main=account_main, sub=account_sub)

        def omhulsels_van(ctrl):
            """Keuzelijst-omhulsels (fpOCXComboBox) rond dit invoervak, voor de pijltjesklik."""
            uit = []
            try:
                r = ctrl.rectangle()
                for c in (uia.descendants() if uia is not None else []):
                    try:
                        cls = (c.element_info.class_name or "").lower()
                        if "combobox" not in cls:
                            continue
                        rr = c.rectangle()
                        if rr.left <= r.left and rr.top <= r.top and rr.right >= r.right and rr.bottom >= r.bottom:
                            uit.append(c)
                    except Exception:
                        continue
            except Exception:
                pass
            return uit

        # Account Number: pijltje, '2099-000' typen, dan TWEE keer Enter —
        # pas bij de tweede Enter zoekt Eagle de omschrijving erbij
        # ("Clearing Account Payments"). Zelfde gedrag als bij Vendor.
        enter_aantal = int(dcfg.get("enter_aantal", 2) or 2)

        def scherm_zelf_gesloten():
            """Waar: Eagle heeft het distributiescherm al zelf gesloten (Enter = OK)."""
            return self._distributie_venster() is None

        def vul_ctrl(naam, ctrl, waarde, keuzelijst=False):
            waarde = str(waarde)
            volgorde = list(self.STRATEGIEEN)
            if keuzelijst:
                volgorde = ["keuzelijst"] + [x for x in volgorde if x != "keuzelijst"]
            else:
                volgorde = [x for x in volgorde if x != "keuzelijst"]
            kandidaten = omhulsels_van(ctrl) if keuzelijst else []
            for strategie in volgorde:
                try:
                    if strategie != "keuzelijst":
                        self._klik_in_veld(ctrl)
                        time.sleep(self.pace / 2)
                    self._voer_in(ctrl, waarde, strategie, kandidaten,
                                  enter_aantal=enter_aantal if keuzelijst else 1,
                                  plakken=keuzelijst)
                    time.sleep(self.pace)
                    commit = self.cfg.get("commit_key", "{TAB}")
                    if commit and strategie != "keuzelijst":
                        ctrl.type_keys(commit, set_foreground=False)
                        time.sleep(self.pace)
                except Exception as e:
                    if scherm_zelf_gesloten():
                        return "gesloten"
                    log(f"  {naam}: manier '{strategie}' mislukt: {e}", "WARN")
                    continue
                if scherm_zelf_gesloten():
                    return "gesloten"
                gelezen = self._lees(ctrl)
                if self._gelijk(gelezen, waarde) or gelezen.replace(" ", "").upper().startswith(waarde.replace(" ", "").upper()):
                    log(f"  {naam:18} = {waarde}   (manier: {strategie}; leest '{gelezen}')")
                    return "ok"
                log(f"  {naam}: manier '{strategie}' gaf '{gelezen}', verwacht '{waarde}'", "WARN")
            raise BridgeStop(
                f"Distributieveld '{naam}' laat zich niet vullen met '{waarde}'. Gestopt vóór OK.\n"
                "De kopregel staat al in Eagle — maak deze boeking zelf af of annuleer het scherm."
            , na_add=True)

        # Eerst kijken of het bedrag al goed staat (Eagle vult het voor),
        # zodat we weten dat een scherm dat na de rekening vanzelf sluit
        # een correcte distributie was.
        bedrag_vooraf = self._lees(toewijzing["amount"])
        bedrag_stond_goed = self._gelijk(bedrag_vooraf, str(bedrag))

        uitkomst = vul_ctrl("distributie account", toewijzing["account"], account_waarde, keuzelijst=True)
        if uitkomst == "gesloten":
            # De tweede Enter heeft in dit geval als OK gewerkt: Eagle heeft de
            # rekening geaccepteerd (bij een onbekende rekening blijft het
            # scherm juist staan) en het scherm gesloten.
            pad = schermafdruk("distributie-zelf-gesloten")
            if not bedrag_stond_goed:
                raise BridgeStop(
                    "Het distributiescherm sloot vanzelf na het kiezen van de rekening, maar het bedrag "
                    f"stond vooraf op '{bedrag_vooraf}' in plaats van '{bedrag}'. Controleer deze boeking in Eagle."
                    + (f"\nSchermafdruk: {pad}" if pad else ""),
                    na_add=True,
                )
            log(f"  distributie: Eagle sloot het scherm zelf na '{account_waarde}' (Enter = OK); bedrag {bedrag} stond al goed — geaccepteerd")
            return
        # Job blijft bewust leeg.
        if bedrag_stond_goed:
            log(f"  {'distributie bedrag':18} = {bedrag}   (stond al ingevuld)")
        else:
            vul_ctrl("distributie bedrag", toewijzing["amount"], bedrag)

        # Laatste controle vóór OK: rekening en bedrag teruglezen.
        fout = []
        rek_gelezen = self._lees(toewijzing["account"])
        if not (self._gelijk(rek_gelezen, account_waarde) or
                rek_gelezen.replace(" ", "").upper().startswith(account_waarde.replace(" ", "").upper())):
            fout.append(f"rekening leest '{rek_gelezen}', verwacht '{account_waarde}'")
        if not self._gelijk(self._lees(toewijzing["amount"]), str(bedrag)):
            fout.append(f"bedrag leest '{self._lees(toewijzing['amount'])}', verwacht '{bedrag}'")
        if fout:
            schermafdruk("distributie-controle")
            raise BridgeStop("Distributiescherm: controle vóór OK mislukt — " + "; ".join(fout) +
                             ". Maak deze boeking zelf af of annuleer.", na_add=True)

        if not dcfg.get("gekalibreerd"):
            schermafdruk("distributie-ingevuld")
            raise BridgeStop(
                "Distributiescherm ingevuld, maar nog niet bevestigd — dit is de eerste keer.\n"
                f"KIJK OP HET SCHERM: staat Account Number op {account_waarde}, Job leeg en het bedrag op {bedrag}?\n"
                "  Klopt het  -> druk zelf op OK in Eagle en meld het; daarna gaat dit vanzelf.\n"
                "  Klopt het niet -> druk Cancel en stuur controls-distribution.txt door.\n"
                f"Structuur: {pad}",
                na_add=True,
            )

        schermafdruk("distributie-voor-ok")
        log("  OK")
        if not self._beantwoord(handle, {"antwoord": dcfg.get("ok_button", "OK"), "knop": "eerste", "enter": True}):
            raise BridgeStop("Kon OK niet aanklikken in het distributiescherm — controleer Eagle.", na_add=True)
        time.sleep(self.pace * 3)

        # OK is pas geslaagd als het distributiescherm verdwenen is. Blijft
        # het staan, dan heeft Eagle de invoer geweigerd (bijv. "Account not
        # on file") en is er NIET geboekt.
        einde = time.time() + 6
        while time.time() < einde and self._distributie_venster():
            time.sleep(0.3)
        if self._distributie_venster():
            pad = schermafdruk("distributie-geweigerd")
            raise BridgeStop(
                "Het distributiescherm bleef na OK staan — Eagle heeft de distributie niet geaccepteerd "
                "(kijk naar de melding onderin het scherm, bijv. 'Account not on file').\n"
                f"Ingevuld: rekening '{account_waarde}', bedrag '{bedrag}'."
                + (f"\nSchermafdruk: {pad}" if pad else ""),
                na_add=True,
            )

    # -- scherm leegmaken (Clear F12) --------------------------------------

    def scherm_is_leeg(self):
        """Waar als het Vendor-vak leeg is (het scherm staat klaar voor een nieuwe regel)."""
        spec = (self.cfg.get("fields") or {}).get("vendor")
        if not spec:
            return True
        try:
            gelezen, _ = self._lees_veld("vendor", spec)
            return not gelezen.strip()
        except Exception:
            return True

    def maak_leeg(self, reden=""):
        """
        Clear F12: zet alle velden van het invoerscherm terug, zoals een
        gebruiker na elke boeking doet. Wordt gedaan na elke geboekte regel
        en, als vangnet, vóór een regel wanneer het scherm nog niet leeg is.
        """
        toets = self.cfg.get("clear_key", "{F12}")
        if not toets:
            return
        log(f"  Clear F12{(' — ' + reden) if reden else ''}")
        try:
            self.win.set_focus()
        except Exception:
            pass
        self.win.type_keys(toets, set_foreground=True)
        time.sleep(self.pace * 4)
        # Vraagt Eagle iets na F12, dan wordt dat als bekend/onbekend venster
        # afgehandeld; onbekend = vastleggen en melden, niet raden.
        try:
            vensters = self._meldingsvensters()
        except Exception:
            vensters = []
        if vensters:
            regel, v = self._bekende_vraag(vensters)
            if regel is not None:
                self._beantwoord(v["handle"], regel)
                time.sleep(self.pace * 2)
            else:
                paden = self._leg_onbekend_vast(vensters)
                log("  na Clear F12 verscheen een venster dat ik niet ken — zie dialogen/ "
                    + ", ".join(p.name for p in paden), "WARN")
        if not self.scherm_is_leeg():
            log("  het scherm is na Clear F12 nog niet leeg (Vendor staat nog gevuld)", "WARN")

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

    # Vangnet: staat er nog iets van een vorige regel, eerst Clear F12.
    if not eagle.scherm_is_leeg():
        eagle.maak_leeg("het scherm was nog niet leeg")
        if not eagle.scherm_is_leeg():
            raise BridgeStop("Het invoerscherm is niet leeg en Clear F12 maakt het niet leeg — "
                             "maak het scherm in Eagle zelf leeg en start opnieuw. Er is niets geboekt.")

    for naam in INVOERVOLGORDE:
        eagle.vul(naam, velden[naam], waarden[naam])

    # Vangnet: vlak vóór Add F4 alle velden nog één keer teruglezen. Een
    # veld dat intussen door de invoer van een ander veld is overschreven,
    # valt hier door de mand — en dan is er nog niets geboekt.
    fouten = []
    for naam in INVOERVOLGORDE:
        spec = velden[naam]
        if spec.get("verify") is False:
            continue
        gelezen, _ = eagle._lees_veld(naam, spec)
        if not eagle._gelijk(gelezen, str(waarden[naam])):
            fouten.append(f"{naam}: '{gelezen}' in plaats van '{waarden[naam]}'")
    if fouten:
        schermafdruk("eindcontrole")
        raise BridgeStop(
            "Eindcontrole vóór Add F4 mislukt — er is niets geboekt:\n  " + "\n  ".join(fouten) +
            "\nWaarschijnlijk is een veld overschreven door de invoer van een later veld."
        )
    log("  eindcontrole: alle velden kloppen")

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

    voucher = eagle.lees_vouchernummer()

    # Klaar: het scherm leegmaken voor de volgende regel (Clear F12), zoals
    # een gebruiker dat na elke boeking doet.
    try:
        eagle.maak_leeg()
    except Exception as e:
        log(f"Clear F12 na de boeking mislukte: {e}", "WARN")

    return voucher


def cmd_run(args):
    global RAPPORTEUR
    cfg, cfgpad, nieuw = laad_config()
    if nieuw:
        log(f"Nieuwe config aangemaakt: {cfgpad}", "WARN")

    # Batch: uit het dashboard (startlink) of uit een bestand.
    bron = str(args.batch).strip().strip('"')
    if bron.lower().startswith("eagleprepay:"):
        try:
            host, batch_uuid, token = ontleed_startlink(bron)
            log(f"Batch ophalen bij {host} ...")
            batch = haal_batch_op(host, batch_uuid, token)
        except BridgeStop as e:
            log(str(e), "ERROR")
            return 2
    else:
        pad = Path(bron)
        if not pad.exists():
            log(f"Batchbestand niet gevonden: {pad}", "ERROR")
            return 2
        batch = json.loads(pad.read_text(encoding="utf-8"))

    # Terugmelden aan het dashboard, als de batch daarvandaan komt.
    rap = batch.get("rapportage") or {}
    if rap.get("id") and rap.get("token") and host_toegestaan(rap.get("host")) and not args.dry_run:
        RAPPORTEUR = Rapporteur(rap["host"], rap["id"], rap["token"])
        log(f"Voortgang wordt teruggemeld aan {rap['host']}.")

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
            # Harde controle: staat Eagle op de store van deze entiteit?
            eagle.controleer_store(batch.get("entiteit"))
        except BridgeStop as e:
            log(str(e), "ERROR")
            if RAPPORTEUR:
                RAPPORTEUR.batch(status="gestopt", laatste_bericht=str(e).splitlines()[0][:300],
                                 machine=socket.gethostname(), bridge_versie=BRIDGE_VERSIE, finished=True)
                RAPPORTEUR.sluit()
            return 4

    # Interactief (gestart door dubbelklik op het batchbestand): eerst
    # laten zien wat er gaat gebeuren en om een Enter vragen.
    if getattr(args, "interactief", False) and not args.dry_run:
        te_doen = [r for r in regels if r["dedupeKey"] not in (geboekte_sleutels() if not args.negeer_ledger else {})]
        print()
        print(f"  Eagle staat op Store {eagle.eagle_store()} ({batch.get('entiteitNaam')}), "
              f"gebruiker {eagle.eagle_gebruiker() or '?'}.")
        print(f"  Er worden {len(te_doen)} regel(s) geboekt op {batch.get('voucherDate')}, "
              f"rekening {batch.get('apRekening')} / {batch.get('distributieRekening')}.")
        if len(te_doen) < len(regels):
            print(f"  {len(regels) - len(te_doen)} regel(s) zijn al eerder geboekt en worden overgeslagen.")
        print()
        print("  Raak muis en toetsenbord NIET aan zolang de Bridge bezig is.")
        print()
        try:
            antwoord = input("  Druk op Enter om te beginnen, of typ N en Enter om te stoppen: ").strip().lower()
        except EOFError:
            antwoord = "n"
        if antwoord.startswith("n"):
            log("Gestopt door de gebruiker vóór het boeken. Er is niets geboekt.")
            if RAPPORTEUR:
                RAPPORTEUR.batch(status="gestopt", laatste_bericht="Gestopt door de gebruiker vóór het boeken.", finished=True)
                RAPPORTEUR.sluit()
            return 7
        print()

    if RAPPORTEUR and not args.dry_run:
        RAPPORTEUR.batch(status="bezig", started=True, machine=socket.gethostname(), bridge_versie=BRIDGE_VERSIE,
                         eagle_store=eagle.eagle_store(), eagle_user=eagle.eagle_gebruiker(),
                         laatste_bericht="Gestart")

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
            if RAPPORTEUR:
                RAPPORTEUR.regel(regel["rij"], status="overgeslagen", voucher=eerder.get("voucher"),
                                 stap="al eerder geboekt", reden=f"Al geboekt op {eerder.get('tijd')}")
            continue

        if RAPPORTEUR:
            RAPPORTEUR.start_regel(regel["rij"])
            RAPPORTEUR.batch(laatste_bericht=f"Regel {i}/{len(regels)} — factuur {regel['vendorRefNo']}",
                             geboekt=gedaan, overgeslagen=overgeslagen)

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
                rij_status = "geboekt_handmatig"
            else:
                schrijf_ledger({
                    "tijd": dt.datetime.now().isoformat(timespec="seconds"),
                    "batchId": batch.get("batchId"), "rij": regel["rij"],
                    "dedupeKey": sleutel, "status": "gestopt", "reden": str(e),
                })
                rij_status = "gestopt"
            log(f"Gestopt na {gedaan} geboekte regel(s).", "ERROR")
            if RAPPORTEUR:
                RAPPORTEUR.regel(regel["rij"], status=rij_status, reden=str(e)[:2000], stap="gestopt")
                RAPPORTEUR.einde_regel()
                RAPPORTEUR.batch(status="gestopt", finished=True, geboekt=gedaan, overgeslagen=overgeslagen, fout=1,
                                 laatste_bericht=f"Gestopt bij rij {regel['rij']}: " + str(e).splitlines()[0][:250])
                RAPPORTEUR.sluit()
            return 5
        except Exception:
            p = schermafdruk("onverwacht")
            log("Onverwachte fout:\n" + traceback.format_exc(), "ERROR")
            if p:
                log(f"Schermafdruk: {p}", "ERROR")
            if RAPPORTEUR:
                RAPPORTEUR.regel(regel["rij"], status="gestopt", reden="Onverwachte fout in de Bridge — zie logboek op de PC.", stap="fout")
                RAPPORTEUR.einde_regel()
                RAPPORTEUR.batch(status="gestopt", finished=True, geboekt=gedaan, overgeslagen=overgeslagen, fout=1,
                                 laatste_bericht=f"Onverwachte fout bij rij {regel['rij']} — zie logboek op de PC.")
                RAPPORTEUR.sluit()
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
        if RAPPORTEUR:
            RAPPORTEUR.regel(regel["rij"], status="geboekt", voucher=voucher, stap="geboekt")
            RAPPORTEUR.einde_regel()
            RAPPORTEUR.batch(geboekt=gedaan, overgeslagen=overgeslagen)

    log("=" * 62)
    if args.dry_run:
        log(f"Proef klaar. {gedaan} regel(s) doorlopen — er is niets in Eagle ingevoerd.")
    else:
        log(f"Klaar. {gedaan} geboekt, {overgeslagen} overgeslagen (al eerder gedaan).")
    if batch.get("handmatig"):
        log(f"Vergeet niet: {len(batch['handmatig'])} regel(s) moeten handmatig geboekt worden.")
    log(f"Logboek: {log.path}")
    if RAPPORTEUR:
        RAPPORTEUR.batch(status="afgerond", finished=True, geboekt=gedaan, overgeslagen=overgeslagen, fout=0,
                         laatste_bericht=f"Klaar: {gedaan} geboekt, {overgeslagen} overgeslagen.")
        RAPPORTEUR.sluit()
        RAPPORTEUR = None
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
    commando = f'"{exe}" "{script}" run "%1" --interactief'

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


def eagleDate_van_vandaag():
    """Laatste dag van de vorige maand, als mm/dd/jj."""
    vandaag = dt.date.today()
    eerste = vandaag.replace(day=1)
    laatste = eerste - dt.timedelta(days=1)
    return laatste.strftime("%m/%d/%y")


# ------------------------------------------------------------------ testbatch

def cmd_testbatch(args):
    """Schrijft een testbatch met N regels (standaard 1), elk met een uniek factuurnummer."""
    import random
    nu = dt.datetime.now()
    ent = args.entiteit
    aantal = max(1, int(args.aantal or 1))
    basis = "99" + nu.strftime("%d%H%M%S")[-7:]        # uniek per seconde, 9 cijfers
    regels = []
    for i in range(aantal):
        nr = basis if aantal == 1 else f"{basis[:-1]}{i + 1}"   # laatste cijfer = volgnummer
        euro = round(random.uniform(20, 900), 2)
        xcg = round(euro * 2, 2)
        regels.append({
            "rij": i + 1, "trxType": "C", "vendor": "4741",
            "voucherDate": args.datum, "invoiceDate": args.datum,
            "vendorRefNo": nr, "apAccount": ["2000", ent], "termsCode": "5",
            "voucherRef": f"VOORUITBET NOBILIA EUR {euro:g}", "invoiceAmount": f"{xcg:.2f}",
            "distribution": {"account": ["2099", ent], "job": "", "amount": f"{xcg:.2f}"},
            "bevestigd": False, "bevestigingen": [], "bedragAangepast": False,
            "dedupeKey": f"TEST|{nr}",
        })
    batch = {
        "batchId": f"TEST-{nu.strftime('%Y%m%d-%H%M%S')}-{ent}",
        "bestand": f"testbatch met {aantal} regel(s) (aangemaakt met 'testbatch', niet uit het dashboard)",
        "entiteit": ent, "entiteitNaam": {"000": "Curacao", "700": "Bonaire"}.get(ent, ent),
        "voucherDate": args.datum, "invoiceDate": args.datum,
        "apRekening": f"2000-{ent}", "distributieRekening": f"2099-{ent}", "koersNorm": 2,
        "regels": regels,
        "handmatig": [],
    }
    pad = SCRIPT_DIR / f"test-{nu.strftime('%H%M%S')}.eaglebatch"
    pad.write_text(json.dumps(batch, indent=2, ensure_ascii=False), encoding="utf-8")
    log(f"Testbatch aangemaakt: {pad.name}  ({aantal} regel(s), entiteit {ent})")
    for r in regels:
        log(f"  rij {r['rij']}: factuur {r['vendorRefNo']}  XCG {r['invoiceAmount']}")
    log(f"Draai:  py -3 eagle_bridge.py run {pad.name}")
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
    r.add_argument("--interactief", action="store_true",
                   help="vraag om bevestiging vóór het boeken en houd het venster open (dubbelklik-modus)")
    t = sub.add_parser("testbatch", help="maak een testbatch met één regel en een uniek factuurnummer")
    t.add_argument("--entiteit", default="000", choices=["000", "700"])
    t.add_argument("--aantal", type=int, default=1, help="aantal testregels in de batch (standaard 1)")
    t.add_argument("--datum", default=eagleDate_van_vandaag(), help="mm/dd/jj, standaard laatste dag vorige maand")

    args = p.parse_args()
    handlers = {"run": cmd_run, "calibrate": cmd_calibrate, "doctor": cmd_doctor,
                "register": cmd_register, "testbatch": cmd_testbatch}
    try:
        code = handlers[args.cmd](args)
    except SystemExit:
        raise
    except Exception:
        log("Onverwachte fout:\n" + traceback.format_exc(), "ERROR")
        code = 9

    if RAPPORTEUR is not None:
        try:
            RAPPORTEUR.sluit()
        except Exception:
            pass

    if args.cmd == "run" and sys.stdin.isatty():
        try:
            input("\nDruk op Enter om te sluiten...")
        except EOFError:
            pass
    log.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
