import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import './ProviderMultiSelect.css';

/**
 * Protocol metadata:
 *   - `id`       wire value (写回 vault.supported_providers / import.protocol_types,
 *                与 CLI provider_fingerprint family IDs 对齐)
 *   - `label`    下拉显示友好名 (带品牌别名提示,如 "zhipu · GLM · 智谱")
 *   - `aliases`  搜索时额外匹配的关键词 (品牌名 / 中文名 / 常用缩写);
 *                用户输入 "GLM" / "moonshot" / "豆包" 能找到对应 id
 */
export type ProtocolMeta = { id: string; label?: string; aliases?: string[] };

/**
 * 默认 protocol 预设清单 — 从 aikey-cli/data/provider_fingerprint.yaml
 * `family_login_urls` / `family_base_urls` keys 校对,排除聚合网关
 * (aggregator_families: openrouter / yunwu / zeroeleven —— 它们不是严格协议,
 * 应让用户选底层实际协议;见 CLI `FingerprintClassifier::aggregator_families`)。
 *
 * qwen / baichuan / minimax 是 UI-only 条目 (YAML 未配 family_*_url),
 * 用户选中后 backend 仅存 protocol 字符串。
 */
export const KNOWN_PROTOCOLS: ProtocolMeta[] = [
  { id: 'anthropic',     label: 'anthropic · Claude',               aliases: ['claude'] },
  { id: 'openai',        label: 'openai · ChatGPT',                 aliases: ['chatgpt', 'gpt'] },
  // 2026-05-08 Kimi 双平台拆分: 'kimi' 拆为 'moonshot' (api.moonshot.cn) +
  // 'kimi_code' (api.kimi.com/coding)。display 标签格式 kimi(moonshot) /
  // kimi(kimi-code) 与 CLI provider_registry.yaml 一致(family 在外、平台在括号)。
  // 'kimi' alias 保留在两条候选的 aliases 里,搜索"kimi"两条都能命中,让用户挑。
  { id: 'moonshot',      label: 'kimi(moonshot) · 月之暗面',         aliases: ['kimi', 'moonshot', '月之暗面'] },
  { id: 'kimi_code',     label: 'kimi(kimi-code) · Kimi 代码',       aliases: ['kimi', 'kimi-code', 'kimicode'] },
  { id: 'deepseek',      label: 'deepseek · 深度求索',               aliases: ['深度求索'] },
  { id: 'google_gemini', label: 'google_gemini · Gemini',           aliases: ['gemini', 'google'] },
  { id: 'groq',          label: 'groq' },
  { id: 'xai_grok',      label: 'xai_grok · Grok',                  aliases: ['grok', 'xai'] },
  { id: 'zhipu',         label: 'zhipu · GLM · 智谱',                aliases: ['glm', 'zhipuai', 'bigmodel', '智谱'] },
  { id: 'doubao',        label: 'doubao · 豆包 · Volcengine Ark',    aliases: ['ark', 'volces', 'volcengine', '豆包'] },
  { id: 'siliconflow',   label: 'siliconflow · 硅基流动',            aliases: ['硅基', 'silicon'] },
  { id: 'qwen',          label: 'qwen · 通义千问 · Dashscope',        aliases: ['tongyi', 'qianwen', 'dashscope', '通义'] },
  { id: 'baichuan',      label: 'baichuan · 百川',                   aliases: ['百川'] },
  { id: 'minimax',       label: 'minimax' },
  { id: 'huggingface',   label: 'huggingface',                      aliases: ['hf'] },
  { id: 'perplexity',    label: 'perplexity',                       aliases: ['pplx'] },
  { id: 'mistral',       label: 'mistral' },
];

/** 判断 protocol 是否匹配搜索串 (id / label / aliases 任一 substring 命中)。 */
export function protocolMatchesQuery(p: ProtocolMeta, queryLc: string): boolean {
  if (p.id.toLowerCase().includes(queryLc)) return true;
  if (p.label && p.label.toLowerCase().includes(queryLc)) return true;
  if (p.aliases && p.aliases.some((a) => a.toLowerCase().includes(queryLc))) return true;
  return false;
}

/**
 * v4.2: family id 映射 chip 样式类 (共 6 档 tier-based 配色)。
 * 精确 provider 识别靠 chip 文字,不靠颜色细分。
 *
 * 6 类: chip-claude / chip-openai / chip-oauth / chip-china / chip-overseas /
 *       chip-gateway / chip-unknown
 */
export function providerChipClassFromId(provId?: string): string {
  if (!provId) return 'chip-unknown';
  const lc = provId.toLowerCase();
  if (lc.includes('anthropic') || lc.includes('claude')) return 'chip-claude';
  if (lc.includes('openai') || lc.startsWith('sk-proj')) return 'chip-openai';
  if (lc.includes('oauth')) return 'chip-oauth';
  if (lc === 'openrouter' || lc === 'yunwu' || lc === 'zeroeleven') return 'chip-gateway';
  // 2026-05-08 Kimi 双平台拆分: 新增 kimi_code / moonshot,'kimi' 保留为 deprecated alias。
  if (lc === 'kimi_code' || lc === 'moonshot' || lc === 'kimi'
      || lc === 'deepseek' || lc === 'zhipu' || lc === 'doubao'
      || lc === 'siliconflow' || lc === 'qwen' || lc === 'baichuan' || lc === 'minimax') {
    return 'chip-china';
  }
  if (lc === 'google_gemini' || lc === 'groq' || lc === 'xai_grok'
      || lc === 'huggingface' || lc === 'perplexity' || lc === 'mistral') {
    return 'chip-overseas';
  }
  return 'chip-unknown';
}

interface ProviderMultiSelectProps {
  values: string[];
  onChange: (next: string[]) => void;
  /** 预设清单,默认 KNOWN_PROTOCOLS */
  presets?: ProtocolMeta[];
  /** 搜索框 placeholder */
  placeholder?: string;
  className?: string;
  /** true 时,values 为空显示 "+ Add" 警告态边框(红)。用于 import 页 Required 提示。 */
  showRequired?: boolean;
}

// Kimi family members share a single env-var (`KIMI_BASE_URL`), so they're
// mutually exclusive at selection time. Hoisted to module scope so both the
// `add()` mutex and the rendered note read from one source.
const KIMI_FAMILY = ['kimi_code', 'moonshot', 'kimi'];

/**
 * ProviderMultiSelect — 多选 provider 下拉 (chips + search + custom add)。
 *
 * 特性:
 *   - 品牌别名搜索 (输入 "GLM" 找到 zhipu / "豆包" 找到 doubao)
 *   - 中英文 label 友好显示
 *   - 自定义 value (输入回车或点 "+ Add custom")
 *   - Portal-based dropdown (position: fixed,z-index: 10000) —
 *     避免弹窗 / 滚动容器 overflow:hidden 导致下拉被裁剪
 *   - Backspace 搜索框空时删最后一个 chip (类似 GitHub labels)
 *
 * 用户项目中的两处使用:
 *   - `pages/user/import/index.tsx` 每张 draft 卡片的 Provider 行
 *   - `pages/user/vault/index.tsx` Add Key 弹窗的 Providers 字段 (v4.2 统一)
 */
export function ProviderMultiSelect({
  values,
  onChange,
  presets = KNOWN_PROTOCOLS,
  placeholder,
  className,
  showRequired = false,
}: ProviderMultiSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('providerMultiSelect.searchPlaceholder');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Tracks whether the Kimi family mute-replace has actually fired in this
  // component's lifetime. The note is reactive: it surfaces only after a
  // real replace, not as preemptive teaching while the user has just one
  // kimi chip. Reset to false when no kimi chip remains (see useEffect below).
  const [hasFiredKimiMutex, setHasFiredKimiMutex] = useState(false);

  const queryLc = query.trim().toLowerCase();
  const availableCandidates = presets.filter((p) => !values.includes(p.id));
  const filtered = queryLc
    ? availableCandidates.filter((p) => protocolMatchesQuery(p, queryLc))
    : availableCandidates;
  const customHit = Boolean(queryLc)
    && !presets.some((p) => p.id.toLowerCase() === queryLc)
    && !values.some((v) => v.toLowerCase() === queryLc);

  // 计算 dropdown 定位: trigger 下方 4px,同宽
  function updateCoords() {
    if (!wrapperRef.current) return;
    const r = wrapperRef.current.getBoundingClientRect();
    setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
  }

  useLayoutEffect(() => {
    if (open) updateCoords();
  }, [open]);

  // 滚动 / 缩放时同步重算,避免 dropdown 悬浮在错位
  useEffect(() => {
    if (!open) return;
    const onChangeEvt = () => updateCoords();
    window.addEventListener('scroll', onChangeEvt, true);
    window.addEventListener('resize', onChangeEvt);
    return () => {
      window.removeEventListener('scroll', onChangeEvt, true);
      window.removeEventListener('resize', onChangeEvt);
    };
  }, [open]);

  // 点击 trigger / dropdown 之外区域关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function add(v: string) {
    const normalized = v.trim().toLowerCase();
    if (!normalized || values.includes(normalized)) return;

    // 2026-05-08 Kimi family select 互斥(详见 update/20260508-Kimi-family互斥-active-env
    // 统一KIMI写入.md 决策 #3 + 第三方评审第八轮): 同一把 KEY 在 Kimi family 内部
    // 只能 supports 一个 protocol —— `KIMI_BASE_URL` 只能指一个上游(api.kimi.com OR
    // api.moonshot.cn,二选一);典型现实情况:sk-kimi-* key 只在 api.kimi.com/coding 工作,
    // 不带 sk-kimi 前缀的 Moonshot key 只在 api.moonshot.cn 工作,跨平台用同 key 几乎不存在。
    //
    // input 层互斥 = 主防御。当用户已选 kimi_code 再选 moonshot,自动 deselect 前者
    // (反之亦然)。deprecated 'kimi' 同 family 同此规则。
    //
    // Why 不报错而是 mute-replace: 用户行为视为"我改主意,改选另一个 platform",
    // 比"对话框/红框警告"流畅。如果用户真的想要双协议(future multi-Kimi gateway),
    // 仍可经 `aikey add --providers kimi_code,moonshot` —— 但目前现实无此场景,所以不留口子。
    let nextValues = values;
    if (KIMI_FAMILY.includes(normalized)) {
      nextValues = values.filter(v => !KIMI_FAMILY.includes(v));
      // Replace actually happened (an existing kimi member was filtered out)
      // → surface the explanatory note. Length-shrink is a sufficient signal
      // because we already short-circuit identical-value adds at the top.
      if (nextValues.length < values.length) {
        setHasFiredKimiMutex(true);
      }
    }
    onChange([...nextValues, normalized]);
    setQuery('');
    // 保持 open,方便连续添加
  }

  function remove(v: string) {
    onChange(values.filter((x) => x !== v));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) add(filtered[0].id);
      else if (customHit) add(query);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Backspace' && query === '' && values.length > 0) {
      remove(values[values.length - 1]);
    }
  }

  const dropdown =
    open && coords
      ? createPortal(
          <div
            ref={dropdownRef}
            className="provider-ms-dropdown"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              zIndex: 10000,
            }}
          >
            {filtered.length === 0 && !customHit && (
              <div className="provider-ms-empty">{t('providerMultiSelect.noMatch')}</div>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className="provider-ms-option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(p.id);
                }}
              >
                {p.label ?? p.id}
              </button>
            ))}
            {customHit && (
              <button
                type="button"
                className="provider-ms-option provider-ms-option-custom"
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(query);
                }}
              >
                {t('providerMultiSelect.addCustom', { query: query.trim().toLowerCase() })}
              </button>
            )}
          </div>,
          document.body,
        )
      : null;

  const addBtnClass =
    showRequired && values.length === 0
      ? 'provider-ms-add-btn provider-ms-add-btn-warn'
      : 'provider-ms-add-btn';

  // Reactive note: surfaces ONLY after a real mute-replace has fired AND a
  // kimi chip is still selected. Reset path keeps it from "sticking" when
  // the user clears all kimi chips and starts fresh.
  const hasKimiSelected = values.some((v) => KIMI_FAMILY.includes(v));
  useEffect(() => {
    if (!hasKimiSelected && hasFiredKimiMutex) {
      setHasFiredKimiMutex(false);
    }
  }, [hasKimiSelected, hasFiredKimiMutex]);
  const showKimiNote = hasFiredKimiMutex && hasKimiSelected;

  return (
    <div ref={wrapperRef} className={`provider-ms ${className ?? ''}`}>
      {values.map((v) => (
        <span key={v} className="provider-ms-chip">
          {v}
          <button
            type="button"
            className="provider-ms-chip-x"
            onClick={() => remove(v)}
            aria-label={t('providerMultiSelect.removeAriaLabel', { value: v })}
          >
            ×
          </button>
        </span>
      ))}
      {open ? (
        <input
          autoFocus
          className="provider-ms-search"
          type="text"
          placeholder={values.length === 0 ? resolvedPlaceholder : t('providerMultiSelect.addMorePlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      ) : (
        <button type="button" className={addBtnClass} onClick={() => setOpen(true)}>
          {t('providerMultiSelect.addButton')}
        </button>
      )}
      {dropdown}
      {/* Note lives INSIDE .provider-ms so callers that use grid/flex layouts
          (e.g. the import page's grid row) treat ProviderMultiSelect as one
          cell instead of two siblings. .provider-ms-note CSS uses
          flex-basis: 100% to wrap to its own row inside the flex container.
          Visibility is reactive (showKimiNote) — only after a real mute-replace
          has fired this lifetime, not preemptive teaching on first kimi pick. */}
      {showKimiNote && (
        <div className="provider-ms-note">
          {t('providerMultiSelect.kimiFamilyNote')}
        </div>
      )}
    </div>
  );
}
