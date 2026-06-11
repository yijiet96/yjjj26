"""統一 LLM 客戶端:支援 Anthropic Claude 與 Google Gemini,
並在「兩者皆無金鑰」時退回規則式(rule-based)分析,確保系統永遠能跑。

設計重點:
- 自動偵測可用金鑰(ANTHROPIC_API_KEY / GEMINI_API_KEY 或 GOOGLE_API_KEY)。
- 統一的 `analyze_json()`:給定 system + user 提示,要求模型回傳 JSON,並安全解析。
- 失敗一律不丟例外給上層,改回退規則式結果(news/social 層自有 fallback)。

注意:Claude/Gemini 的「網頁訂閱」(Claude Enterprise、Gemini Pro 網頁版)不是 API 金鑰,
無法被自動程式呼叫。要讓每日自動化使用模型,需在 .env 填入 API 金鑰:
  - Anthropic:https://console.anthropic.com  → ANTHROPIC_API_KEY
  - Google AI Studio(有免費額度):https://aistudio.google.com/apikey → GEMINI_API_KEY
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..config import load_settings
from ..utils import get_logger

log = get_logger("llm")

# 預設模型(可用環境變數覆寫)
DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


@dataclass
class LLMResult:
    provider: str            # "anthropic" | "gemini" | "rule_based"
    raw: str
    data: dict[str, Any]


def _extract_json(text: str) -> dict[str, Any]:
    """從模型輸出中盡力擷取 JSON 物件。"""
    text = text.strip()
    # 去除 ```json fences
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return {}


class LLMClient:
    """惰性初始化的多供應商客戶端。"""

    def __init__(self) -> None:
        s = load_settings()
        self.anthropic_key = s.key("ANTHROPIC_API_KEY")
        self.gemini_key = s.key("GEMINI_API_KEY") or s.key("GOOGLE_API_KEY")
        self.claude_model = s.key("CLAUDE_MODEL", DEFAULT_CLAUDE_MODEL)
        self.gemini_model = s.key("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        self._anthropic = None
        self._gemini = None

    @property
    def available(self) -> bool:
        return bool(self.anthropic_key or self.gemini_key)

    @property
    def provider(self) -> str:
        if self.anthropic_key:
            return "anthropic"
        if self.gemini_key:
            return "gemini"
        return "rule_based"

    # ---- 供應商呼叫 -----------------------------------------------------
    def _call_anthropic(self, system: str, user: str, max_tokens: int) -> str:
        if self._anthropic is None:
            import anthropic  # 延遲匯入
            self._anthropic = anthropic.Anthropic(api_key=self.anthropic_key)
        resp = self._anthropic.messages.create(
            model=self.claude_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        return "".join(getattr(b, "text", "") for b in resp.content)

    def _call_gemini(self, system: str, user: str, max_tokens: int) -> str:
        if self._gemini is None:
            import google.generativeai as genai  # 延遲匯入
            genai.configure(api_key=self.gemini_key)
            self._gemini = genai.GenerativeModel(
                self.gemini_model, system_instruction=system
            )
        resp = self._gemini.generate_content(
            user,
            generation_config={"max_output_tokens": max_tokens,
                               "response_mime_type": "application/json"},
        )
        return resp.text or ""

    # ---- 公開 API -------------------------------------------------------
    def analyze_json(self, system: str, user: str, max_tokens: int = 1024) -> LLMResult:
        """要求模型回傳 JSON。任何錯誤都回退為空 dict(由上層 rule-based 接手)。"""
        provider = self.provider
        if provider == "rule_based":
            return LLMResult("rule_based", "", {})
        try:
            text = (self._call_anthropic(system, user, max_tokens)
                    if provider == "anthropic"
                    else self._call_gemini(system, user, max_tokens))
            return LLMResult(provider, text, _extract_json(text))
        except Exception as e:  # noqa: BLE001
            log.warning("LLM(%s)呼叫失敗,退回規則式:%s", provider, e)
            return LLMResult("rule_based", "", {})


_singleton: LLMClient | None = None


def get_client() -> LLMClient:
    global _singleton
    if _singleton is None:
        _singleton = LLMClient()
    return _singleton
