#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
============================================================
 EAGLE BRIDGE  —  vooruitbetalingen Keukendepot
 Booming Solutions / Building Depot
============================================================

Voert de door het dashboard goedgekeurde vooruitbetalingen in
Eagle in, in het scherm "New A/P Transactions".

WAAROM DIT PROGRAMMA BESTAAT
  Eagle draait op het eigen netwerk en heeft in deze versie geen
  A/P-import. Het dashboard draait in de cloud en kan Eagle dus
  nooit rechtstreeks bereiken. Deze Bridge draait op de PC waar
  Eagle openstaat en typt de regels in, precies zoals een
  medewerker dat met de hand zou doen.

GRONDREGELS (niet aanpassen zonder overleg)
  1. Elk veld wordt na het typen teruggelezen. Klopt het niet,
     dan stopt de Bridge vóór "Add F4" — er is dan niets geboekt.
  2. Alleen dialogen uit BEKENDE_DIALOGEN worden beantwoord.
     Elk ander venster: stoppen, schermafdruk, melden.
  3. Elke geboekte regel gaat met zijn dedupeKey in ledger.jsonl.
     Een herstart slaat die regels over. Dubbel boeken kan niet.
  4. Bij twijfel stoppen. Nooit gokken.

GEBRUIK
  python eagle_bridge.py doctor
  python eagle_bridge.py calibrate
  python eagle_bridge.py run batch.eaglebatch --dry-run
  python eagle_bridge.py run batch.eaglebatch --limit 1
  python eagle_bridge.py run batch.eaglebatch
  python eagle_bridge.py register

BENODIGD
  Python 3.9+ op Windows, plus:
      pip install pywinauto pillow
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

APP_DIR = Path(os.environ.get("APPDATA", Path.home())) / "EagleBridge"
CONFIG_PATH = APP_DIR / "config.json"
LEDGER_PATH = APP_DIR / "ledger.jsonl"
LOG_DIR = APP_DIR / "logs"
SHOT_DIR = APP_DIR / "screenshots"

# ------------------------------------------------------------------ config

STANDAARD_CONFIG = {
    "_uitleg": "Vul de veldnamen in met wat 'calibrate' in controls.txt heeft gevonden.",
    "window_title_re": ".*New A/P Transactions.*",
    "backend": "uia",

    # Pauze tussen handelingen. Hoger = trager maar rustiger voor Eagle.
    "pace_seconds": 0.25,
    "dialog_wait_seconds": 6.0,
    "field_retries": 2,

    # Elk veld: hoe de Bridge het vindt. Vul één van auto_id / title / index.
    # 'index' is de volgorde waarin calibrate de Edit-velden tegenkwam.
    "fields": {
        "trx_type":        {"auto_id": "", "title": "", "index": None},
        "vendor":          {"auto_id": "", "title": "", "index": None},
        "voucher_date":    {"auto_id": "", "title": "", "index": None},
        "invoice_date":    {"auto_id": "", "title": "", "index": None},
        "vendor_ref_no":   {"auto_id": "", "title": "", "index": None},
        "ap_account_main": {"auto_id": "", "title": "", "index": None},
        "ap_account_sub":  {"auto_id": "", "title": "", "index": None},
        "terms_code":      {"auto_id": "", "title": "", "index": None},
        "voucher_ref":     {"auto_id": "", "title": "", "index": None},
        "invoice_amount":  {"auto_id": "", "title": "", "index": None},
    },

    # Scherm 'Add distribution' dat na Add F4 verschijnt.
    "distribution": {
        "window_title_re": ".*[Aa]dd distribution.*",
        "account_number": {"auto_id": "", "title": "", "index": 0},
        "job":            {"auto_id": "", "title": "", "index": 1},
        "amount":         {"auto_id": "", "title": "", "index": 2},
        "ok_button":      "OK",
    },

    # Waar het toegekende vouchernummer staat (voor de terugmelding).
    "current_voucher": {"auto_id": "", "title": "", "index": None},

    # Velden die de Bridge NOOIT aanraakt.
    "niet_aanraken": ["Due Date", "Disc Date", "Check Date", "Check No"],
}

# Dialogen die de Bridge zelf mag beantwoorden. Alles daarbuiten = stoppen.
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


log = None  # wordt in main() gezet


# ------------------------------------------------------------------ helpers

def laad_config():
    if not CONFIG_PATH.exists():
        APP_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(STANDAARD_CONFIG, indent=2, ensure_ascii=False), encoding="utf-8")
        return STANDAARD_CONFIG, True
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    # ontbrekende sleutels aanvullen zonder bestaande te overschrijven
    for k, v in STANDAARD_CONFIG.items():
        cfg.setdefault(k, v)
    return cfg, False


def config_is_ingevuld(cfg):
    for naam, spec in cfg["fields"].items():
        if not (spec.get("auto_id") or spec.get("title") or spec.get("index") is not None):
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


class BridgeStop(Exception):
    """Gecontroleerd stoppen: er is niets half geboekt."""


# ------------------------------------------------------------------ Eagle

class Eagle:
    def __init__(self, cfg):
        self.cfg = cfg
        self.pace = float(cfg.get("pace_seconds", 0.25))
        from pywinauto import Desktop
        self.desktop = Desktop(backend=cfg.get("backend", "uia"))
        self.win = None

    # -- venster ---------------------------------------------------------

    def verbind(self):
        titel = self.cfg["window_title_re"]
        try:
            self.win = self.desktop.window(title_re=titel)
            self.win.wait("exists ready", timeout=10)
        except Exception:
            raise BridgeStop(
                "Het scherm 'New A/P Transactions' is niet gevonden.\n"
                "Open Eagle op: Accounts Payable > Daily Procedures > New A/P Transactions,\n"
                "laat het scherm leeg staan en start opnieuw."
            )
        self.win.set_focus()
        time.sleep(self.pace)
        return self.win

    def edits(self):
        """Alle invoervelden in het hoofdscherm, in schermvolgorde."""
        try:
            items = self.win.descendants(control_type="Edit")
        except Exception:
            items = self.win.descendants(class_name="Edit")
        return items

    def zoek_veld(self, spec, pool=None):
        pool = self.edits() if pool is None else pool
        auto_id = (spec or {}).get("auto_id") or ""
        titel = (spec or {}).get("title") or ""
        index = (spec or {}).get("index")

        if auto_id:
            for c in pool:
                try:
                    if c.element_info.automation_id == auto_id:
                        return c
                except Exception:
                    pass
        if titel:
            for c in pool:
                try:
                    if (c.element_info.name or "").strip() == titel:
                        return c
                except Exception:
                    pass
        if index is not None and 0 <= index < len(pool):
            return pool[index]
        return None

    # -- invoeren --------------------------------------------------------

    def vul(self, naam, spec, waarde, pool=None):
        """Typt een waarde en leest hem terug. Klopt het niet: stoppen."""
        waarde = "" if waarde is None else str(waarde)
        pogingen = int(self.cfg.get("field_retries", 2))

        for poging in range(1, pogingen + 1):
            veld = self.zoek_veld(spec, pool)
            if veld is None:
                raise BridgeStop(
                    f"Veld '{naam}' is niet gevonden in het scherm.\n"
                    "Draai 'python eagle_bridge.py calibrate' — waarschijnlijk is Eagle gewijzigd."
                )
            try:
                veld.set_focus()
                time.sleep(self.pace / 2)
                veld.type_keys("^a{DEL}", set_foreground=False)
                time.sleep(self.pace / 2)
                veld.type_keys(waarde, with_spaces=True, set_foreground=False)
                time.sleep(self.pace)
                gelezen = (veld.window_text() or "").strip()
            except Exception as e:
                log(f"veld '{naam}' poging {poging} mislukt: {e}", "WARN")
                time.sleep(self.pace)
                continue

            if self._gelijk(gelezen, waarde):
                log(f"  {naam:18} = {waarde}")
                return True
            log(f"veld '{naam}' poging {poging}: gelezen '{gelezen}', verwacht '{waarde}'", "WARN")
            time.sleep(self.pace)

        raise BridgeStop(
            f"Veld '{naam}' bleef afwijken: verwacht '{waarde}'.\n"
            "Er is niets geboekt. Controleer of iemand in Eagle heeft geklikt tijdens het draaien."
        )

    @staticmethod
    def _gelijk(gelezen, verwacht):
        g = gelezen.replace(" ", "").replace(",", ".").lstrip("0") or "0"
        v = verwacht.replace(" ", "").replace(",", ".").lstrip("0") or "0"
        if g == v:
            return True
        # bedragen: 32.8 vs 32.80
        try:
            return abs(float(g) - float(v)) < 0.005
        except ValueError:
            return False

    # -- dialogen --------------------------------------------------------

    def open_dialoog(self):
        """Geeft het bovenliggende dialoogvenster terug, of None."""
        try:
            for w in self.desktop.windows():
                try:
                    titel = (w.window_text() or "")
                except Exception:
                    continue
                if "A/P Add New Transaction" in titel or "Add distribution" in titel:
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
        """Beantwoordt bekende dialogen. Onbekend venster: stoppen."""
        wacht = float(self.cfg.get("dialog_wait_seconds", 6.0))
        distributie_titel = self.cfg["distribution"]["window_title_re"].strip(".*")

        for _ in range(max_rondes):
            einde = time.time() + wacht
            dlg = None
            while time.time() < einde:
                dlg = self.open_dialoog()
                if dlg is not None:
                    break
                time.sleep(0.2)
            if dlg is None:
                return  # geen dialoog meer

            tekst = self.dialoogtekst(dlg)

            if "add distribution" in tekst:
                return  # dit scherm handelen we apart af

            geraakt = None
            for regel in BEKENDE_DIALOGEN:
                if regel["bevat"] in tekst:
                    geraakt = regel
                    break

            if geraakt is None:
                pad = schermafdruk("onbekend-dialoog")
                raise BridgeStop(
                    "Onbekend venster in Eagle — gestopt zonder te raden.\n"
                    f"Tekst: {tekst[:300]}\n"
                    + (f"Schermafdruk: {pad}\n" if pad else "")
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

    def vul_distributie(self, account_main, bedrag):
        dcfg = self.cfg["distribution"]
        einde = time.time() + float(self.cfg.get("dialog_wait_seconds", 6.0))
        dlg = None
        while time.time() < einde:
            try:
                kandidaat = self.desktop.window(title_re=dcfg["window_title_re"])
                if kandidaat.exists():
                    dlg = kandidaat
                    break
            except Exception:
                pass
            time.sleep(0.2)

        if dlg is None:
            pad = schermafdruk("geen-distributie")
            raise BridgeStop(
                "Het scherm 'Add distribution' verscheen niet na Add F4.\n"
                "De kopregel kan al geboekt zijn — controleer dit in Eagle vóór je opnieuw start."
                + (f"\nSchermafdruk: {pad}" if pad else "")
            )

        dlg.set_focus()
        try:
            pool = dlg.descendants(control_type="Edit")
        except Exception:
            pool = dlg.descendants(class_name="Edit")

        self.vul("distributie account", dcfg["account_number"], account_main, pool=pool)
        # Job blijft bewust leeg.
        self.vul("distributie bedrag", dcfg["amount"], bedrag, pool=pool)

        try:
            dlg.child_window(title=dcfg.get("ok_button", "OK"), control_type="Button").click_input()
        except Exception:
            dlg.type_keys("{ENTER}")
        time.sleep(self.pace * 3)

    # -- vouchernummer ---------------------------------------------------

    def lees_vouchernummer(self):
        spec = self.cfg.get("current_voucher") or {}
        veld = self.zoek_veld(spec)
        if veld is None:
            return None
        try:
            return (veld.window_text() or "").strip() or None
        except Exception:
            return None


# ------------------------------------------------------------------ run

def voer_regel_in(eagle, regel, entiteit, dry_run):
    velden = eagle.cfg["fields"]
    ap_main, ap_sub = regel["apAccount"]
    dist_main, _dist_sub = regel["distribution"]["account"]

    plan = [
        ("trx_type",        velden["trx_type"],        regel["trxType"]),
        ("vendor",          velden["vendor"],          regel["vendor"]),
        ("voucher_date",    velden["voucher_date"],    regel["voucherDate"]),
        ("invoice_date",    velden["invoice_date"],    regel["invoiceDate"]),
        ("vendor_ref_no",   velden["vendor_ref_no"],   regel["vendorRefNo"]),
        ("ap_account_main", velden["ap_account_main"], ap_main),
        ("ap_account_sub",  velden["ap_account_sub"],  ap_sub),
        ("terms_code",      velden["terms_code"],      regel["termsCode"]),
        ("voucher_ref",     velden["voucher_ref"],     regel["voucherRef"]),
        ("invoice_amount",  velden["invoice_amount"],  regel["invoiceAmount"]),
    ]

    if dry_run:
        for naam, _spec, waarde in plan:
            log(f"  [proef] {naam:18} = {waarde}")
        log(f"  [proef] Add F4")
        log(f"  [proef] distributie {dist_main}-{entiteit}, Job leeg, bedrag {regel['distribution']['amount']}")
        return None

    eagle.verbind()
    for naam, spec, waarde in plan:
        eagle.vul(naam, spec, waarde)

    log("  Add F4")
    eagle.win.type_keys("{F4}")
    time.sleep(eagle.pace * 3)

    eagle.handel_dialogen_af()
    eagle.vul_distributie(dist_main, regel["distribution"]["amount"])
    eagle.handel_dialogen_af()

    return eagle.lees_vouchernummer()


def cmd_run(args):
    cfg, nieuw = laad_config()
    if nieuw:
        log(f"Nieuwe config aangemaakt: {CONFIG_PATH}", "WARN")

    pad = Path(args.batch)
    if not pad.exists():
        log(f"Batchbestand niet gevonden: {pad}", "ERROR")
        return 2
    batch = json.loads(pad.read_text(encoding="utf-8"))

    entiteit = batch["entiteit"]
    regels = batch["regels"]
    if args.limit:
        regels = regels[: args.limit]

    log("=" * 62)
    log(f"Batch      : {batch.get('batchId')}")
    log(f"Bestand    : {batch.get('bestand')}")
    log(f"Entiteit   : {entiteit} ({batch.get('entiteitNaam')})")
    log(f"Datum      : {batch.get('voucherDate')}")
    log(f"Rekeningen : {batch.get('apRekening')} / {batch.get('distributieRekening')}")
    log(f"Regels     : {len(regels)}" + (f" (beperkt tot {args.limit})" if args.limit else ""))
    if batch.get("handmatig"):
        log(f"Handmatig  : {len(batch['handmatig'])} regel(s) gaan NIET mee")
    log("=" * 62)

    if not args.dry_run:
        ok, ontbrekend = config_is_ingevuld(cfg)
        if not ok:
            log(f"Veld '{ontbrekend}' is nog niet gekoppeld in {CONFIG_PATH}.", "ERROR")
            log("Draai eerst: python eagle_bridge.py calibrate", "ERROR")
            return 3

    eagle = None
    if not args.dry_run:
        try:
            eagle = Eagle(cfg)
            eagle.verbind()
            log("Eagle gevonden op New A/P Transactions.")
        except BridgeStop as e:
            log(str(e), "ERROR")
            return 4
    else:
        eagle = Eagle.__new__(Eagle)  # geen venster nodig in proefmodus
        eagle.cfg = cfg
        eagle.pace = 0

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
            voucher = voer_regel_in(eagle, regel, entiteit, args.dry_run)
        except BridgeStop as e:
            log(str(e), "ERROR")
            schrijf_ledger({
                "tijd": dt.datetime.now().isoformat(timespec="seconds"),
                "batchId": batch.get("batchId"), "rij": regel["rij"],
                "dedupeKey": sleutel, "status": "gestopt", "reden": str(e),
            })
            log(f"Gestopt na {gedaan} geboekte regel(s). Niets half ingevoerd.", "ERROR")
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
                "bedrag": regel["invoiceAmount"], "entiteit": entiteit,
            })
            log(f"  geboekt" + (f" — voucher {voucher}" if voucher else ""))
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
    cfg, _ = laad_config()
    try:
        eagle = Eagle(cfg)
        eagle.verbind()
    except BridgeStop as e:
        log(str(e), "ERROR")
        return 4

    APP_DIR.mkdir(parents=True, exist_ok=True)
    uit = APP_DIR / "controls.txt"
    regels = []
    regels.append("Alle bedieningselementen in 'New A/P Transactions'.")
    regels.append("Zoek per veld de regel die erbij hoort en zet auto_id (of index) in config.json.")
    regels.append("=" * 78)

    try:
        alles = eagle.win.descendants()
    except Exception as e:
        log(f"Kon het venster niet uitlezen: {e}", "ERROR")
        return 5

    edit_index = 0
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
        idx = ""
        if str(ct).lower() in ("edit", "edit control"):
            idx = f"  index={edit_index}"
            edit_index += 1
        regels.append(f"[{ct}]{idx}  auto_id='{aid}'  name='{naam}'  text='{tekst}'  pos={rect}")

    uit.write_text("\n".join(regels), encoding="utf-8")
    log(f"{len(alles)} elementen gevonden, waarvan {edit_index} invoervelden.")
    log(f"Geschreven naar: {uit}")
    log(f"Config staat in: {CONFIG_PATH}")
    log("")
    log("Stuur controls.txt door, dan vul ik config.json voor je in.")
    try:
        os.startfile(str(uit))
    except Exception:
        pass
    return 0


# ------------------------------------------------------------------ doctor

def cmd_doctor(_args):
    log(f"Python      : {sys.version.split()[0]}  ({sys.executable})")
    log(f"Werkmap     : {APP_DIR}")
    ok = True

    try:
        import pywinauto  # noqa: F401
        log("pywinauto   : aanwezig")
    except ImportError:
        log("pywinauto   : ONTBREEKT  ->  pip install pywinauto", "ERROR")
        ok = False
    try:
        from PIL import ImageGrab  # noqa: F401
        log("pillow      : aanwezig")
    except ImportError:
        log("pillow      : ONTBREEKT  ->  pip install pillow", "WARN")

    cfg, nieuw = laad_config()
    log(f"config.json : {'nieuw aangemaakt' if nieuw else 'gevonden'} ({CONFIG_PATH})")
    ingevuld, ontbrekend = config_is_ingevuld(cfg)
    if ingevuld:
        log("velden      : gekoppeld")
    else:
        log(f"velden      : nog niet gekoppeld (eerste: {ontbrekend})  ->  calibrate", "WARN")
        ok = False

    if not ok:
        return 1

    try:
        eagle = Eagle(cfg)
        eagle.verbind()
        log("Eagle       : scherm New A/P Transactions gevonden")
    except BridgeStop as e:
        log("Eagle       : " + str(e).splitlines()[0], "WARN")

    n = len(geboekte_sleutels())
    log(f"ledger      : {n} eerder geboekte regel(s)")
    return 0


# ------------------------------------------------------------------ register

def cmd_register(_args):
    """Koppelt .eaglebatch aan dit programma en registreert eagleprepay://."""
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

    # bestandstype .eaglebatch
    zet(r"Software\Classes\.eaglebatch", "EagleBridge.Batch")
    zet(r"Software\Classes\EagleBridge.Batch", "Eagle vooruitbetalingen-batch")
    zet(r"Software\Classes\EagleBridge.Batch\shell\open\command", commando)

    # protocol eagleprepay://
    zet(r"Software\Classes\eagleprepay", "URL:Eagle Bridge")
    zet(r"Software\Classes\eagleprepay", "", "URL Protocol")
    zet(r"Software\Classes\eagleprepay\shell\open\command", f'"{exe}" "{script}" run "%1"')

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

    sub.add_parser("doctor", help="controleer installatie en verbinding")
    sub.add_parser("calibrate", help="lees het Eagle-scherm uit en schrijf controls.txt")
    sub.add_parser("register", help="koppel .eaglebatch en eagleprepay:// aan dit programma")

    r = sub.add_parser("run", help="voer een batch in Eagle in")
    r.add_argument("batch", help="pad naar het .eaglebatch-bestand")
    r.add_argument("--dry-run", action="store_true", help="toon alleen wat er getypt zou worden")
    r.add_argument("--limit", type=int, default=0, help="alleen de eerste N regels")

    args = p.parse_args()
    handlers = {"run": cmd_run, "calibrate": cmd_calibrate, "doctor": cmd_doctor, "register": cmd_register}
    try:
        code = handlers[args.cmd](args)
    finally:
        pass

    if args.cmd == "run" and sys.stdin.isatty():
        input("\nDruk op Enter om te sluiten...")
    log.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
