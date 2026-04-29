import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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
  { id: 'kimi',          label: 'kimi · Moonshot · 月之暗面',        aliases: ['moonshot', '月之暗面'] },
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
  if (lc === 'kimi' || lc === 'deepseek' || lc === 'zhipu' || lc === 'doubao'
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
  placeholder = 'Search or type custom…',
  className,
  showRequired = false,
}: ProviderMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    onChange([...values, normalized]);
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
              <div className="provider-ms-empty">No match</div>
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
                + Add custom: "{query.trim().toLowerCase()}"
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

  return (
    <div ref={wrapperRef} className={`provider-ms ${className ?? ''}`}>
      {values.map((v) => (
        <span key={v} className="provider-ms-chip">
          {v}
          <button
            type="button"
            className="provider-ms-chip-x"
            onClick={() => remove(v)}
            aria-label={`Remove ${v}`}
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
          placeholder={values.length === 0 ? placeholder : 'Add more…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
        />
      ) : (
        <button type="button" className={addBtnClass} onClick={() => setOpen(true)}>
          + Add
        </button>
      )}
      {dropdown}
    </div>
  );
}
