"""簡報送達:Email(SMTP)。忙碌上班族每天打開信箱就能看到當日簡報。

設定(.env):
  SMTP_HOST, SMTP_PORT(預設 587), SMTP_USER, SMTP_PASS, REPORT_TO
Gmail 建議用「應用程式密碼」(App Password),非一般登入密碼。
未設定時自動略過(只存檔到 reports/)。
"""
from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from ..config import load_settings
from ..utils import get_logger

log = get_logger("agent")


def send_email(subject: str, html_body: str,
               attachments: list[Path] | None = None) -> bool:
    s = load_settings()
    host = s.key("SMTP_HOST")
    user = s.key("SMTP_USER")
    pw = s.key("SMTP_PASS")
    to = s.key("REPORT_TO") or user
    if not (host and user and pw and to):
        log.info("未設定 SMTP_*,略過寄信(報告已存於 reports/)。")
        return False
    port = int(s.key("SMTP_PORT", "587"))

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = to
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(host, port, timeout=30) as srv:
            srv.starttls()
            srv.login(user, pw)
            srv.sendmail(user, [a.strip() for a in to.split(",")], msg.as_string())
        log.info("已寄出每日簡報 → %s", to)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("寄信失敗(報告仍已存檔):%s", e)
        return False
