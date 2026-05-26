/**
 * Phase 4 阶段 4 — One-time token reveal modal (2026-05-25).
 *
 * Shown AFTER a successful POST /api/user/apps/register. Displays the
 * plaintext `route_token` exactly once — the API contract is that the
 * token is never returned again (recovery path = rotate from the app's
 * detail page).
 *
 * The visual emphasis pattern is intentional: red banner at top, large
 * monospace env block, primary "Copy" button. This mirrors how GitHub
 * shows a PAT once after creation — a known UX pattern users have
 * already internalised the "save now or lose it" expectation for.
 *
 * Also surfaces the snapshotted bindings so the user knows which key
 * the new bearer will route to before they paste the token into their
 * agent. If `aikey use` had no selection for one of the declared
 * upstreams, a yellow warning lists those missing upstreams so the user
 * can fix before traffic 4xx's at runtime.
 */
import { useEffect, useState } from 'react';

import type { AppRegisterResponse } from '@/shared/api/user/apps';

export interface TokenRevealModalProps {
  result: AppRegisterResponse;
  /** Called when the user clicks Done. Parent typically also invalidates
   *  the apps list query so the new row appears. */
  onClose: () => void;
}

type CopiedSdk = 'openai' | 'anthropic' | null;

export function TokenRevealModal({ result, onClose }: TokenRevealModalProps) {
  const [copied, setCopied] = useState<CopiedSdk>(null);

  // Reset the "Copied" pill back to default after ~2s so the button is
  // always actionable.
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  // Each SDK family reads a different env var name AND appends a
  // different request path, so base_url must be shaped per-SDK:
  //
  //   OpenAI-style SDK   →   OPENAI_BASE_URL  =  .../apps/<slug>/v1
  //                          SDK appends /chat/completions
  //
  //   Anthropic SDK      →   ANTHROPIC_BASE_URL  =  .../apps/<slug>
  //                          SDK appends /v1/messages
  //
  // A user pasting the OpenAI-shaped URL into ANTHROPIC_BASE_URL would
  // produce /apps/<slug>/v1/v1/messages on the wire and trip the
  // BASE_URL_MISCONFIGURED 400 guard in the proxy. Showing both blocks
  // here avoids that footgun (matches the Agent-Quickstart docs).
  const openaiBaseUrl = result.base_url;
  const anthropicBaseUrl = result.base_url.replace(/\/v1$/, '');

  const openaiEnvBlock = [
    `OPENAI_API_KEY=${result.route_token}`,
    `OPENAI_BASE_URL=${openaiBaseUrl}`,
  ].join('\n');
  const anthropicEnvBlock = [
    `ANTHROPIC_API_KEY=${result.route_token}`,
    `ANTHROPIC_BASE_URL=${anthropicBaseUrl}`,
  ].join('\n');

  const handleCopy = (sdk: Exclude<CopiedSdk, null>, text: string) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(sdk);
    } catch {
      // Older browsers / non-secure-context — fall back to a manual
      // select. Modal still shows the text so the user can copy by hand.
      setCopied(null);
    }
  };

  const hasMissing = result.missing_upstreams_for_aikey_use.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="token-reveal-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(2px)' }}
    >
      {/* No backdrop onClick handler here — closing this modal accidentally
          would mean losing the token. The user must click Done explicitly. */}
      <div
        className="rounded-md border shadow-lg w-full max-w-[640px] max-h-[90vh] flex flex-col"
        style={{
          background: 'var(--card)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2
            id="token-reveal-title"
            className="text-base font-semibold font-mono"
            style={{ color: 'var(--foreground)' }}
          >
            App registered — <span style={{ color: '#ca8a04' }}>{result.slug}</span>
          </h2>
          <p
            className="text-[12px] mt-1"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {result.action === 'inserted'
              ? 'A new bearer has been issued. Configure your agent with the env block below.'
              : 'Re-registered. The existing bearer was reused (its plaintext is shown below for your records).'}
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* Big red warning banner — keep this visually loud */}
          <div
            className="rounded border p-3"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              borderColor: 'var(--destructive, #ef4444)',
            }}
          >
            <div
              className="font-mono text-[12px] uppercase tracking-wider mb-1"
              style={{ color: 'var(--destructive, #ef4444)' }}
            >
              Save this token now
            </div>
            <p
              className="text-[12px]"
              style={{ color: 'var(--foreground)' }}
            >
              It won't be shown again. If you lose it, use{' '}
              <span className="font-mono">Rotate</span> from this app's detail page to
              issue a new one.
            </p>
          </div>

          {/* Env blocks — one per SDK family. The note below the header
              tells the user to pick the block that matches their agent;
              the docs (Agent-Quickstart) carry the full SDK→block table. */}
          <div className="space-y-3">
            <p
              className="text-[12px]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Pick the block matching your agent's SDK. The two URL forms
              differ — the SDK appends its own path suffix.
            </p>

            {/* OpenAI SDK block */}
            <div>
              <div
                className="flex items-center justify-between mb-1"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <span className="text-[12px] font-mono uppercase tracking-wider">
                  OpenAI SDK · openai-python · OpenCode · LangChain
                </span>
                <button
                  type="button"
                  onClick={handleCopy('openai', openaiEnvBlock)}
                  className="rounded px-2 py-1 text-[11px] font-mono uppercase tracking-wider"
                  style={{
                    background:
                      copied === 'openai'
                        ? 'var(--success, #16a34a)'
                        : '#ca8a04',
                    color: 'var(--primary-foreground, #18181b)',
                  }}
                >
                  {copied === 'openai' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre
                className="rounded border p-3 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-all"
                style={{
                  background: 'var(--secondary, #3f3f46)',
                  color: 'var(--foreground)',
                  borderColor: 'var(--border)',
                }}
              >
{openaiEnvBlock}
              </pre>
            </div>

            {/* Anthropic SDK block */}
            <div>
              <div
                className="flex items-center justify-between mb-1"
                style={{ color: 'var(--muted-foreground)' }}
              >
                <span className="text-[12px] font-mono uppercase tracking-wider">
                  Anthropic SDK · Claude Code · anthropic-python
                </span>
                <button
                  type="button"
                  onClick={handleCopy('anthropic', anthropicEnvBlock)}
                  className="rounded px-2 py-1 text-[11px] font-mono uppercase tracking-wider"
                  style={{
                    background:
                      copied === 'anthropic'
                        ? 'var(--success, #16a34a)'
                        : '#ca8a04',
                    color: 'var(--primary-foreground, #18181b)',
                  }}
                >
                  {copied === 'anthropic' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre
                className="rounded border p-3 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap break-all"
                style={{
                  background: 'var(--secondary, #3f3f46)',
                  color: 'var(--foreground)',
                  borderColor: 'var(--border)',
                }}
              >
{anthropicEnvBlock}
              </pre>
            </div>
          </div>

          {/* Snapshotted bindings — what the new bearer will actually
              route to. If empty AND there are missing upstreams, the
              snapshot panel collapses (warning panel below carries the
              message). */}
          {result.snapshotted_bindings.length > 0 ||
          result.preserved_bindings.length > 0 ? (
            <div>
              <div
                className="text-[12px] font-mono uppercase tracking-wider mb-1"
                style={{ color: 'var(--muted-foreground)' }}
              >
                Will route to
              </div>
              <ul
                className="rounded border p-3 text-[12px] font-mono space-y-1"
                style={{
                  background: 'var(--card)',
                  borderColor: 'var(--border)',
                }}
              >
                {result.snapshotted_bindings.map((b) => (
                  <li
                    key={`snap-${b.upstream}`}
                    className="flex items-center gap-2"
                    style={{ color: 'var(--foreground)' }}
                  >
                    <span style={{ color: '#ca8a04' }}>{b.upstream}</span>
                    <span style={{ color: 'var(--muted-foreground)' }}>→</span>
                    <span>{b.key_source_label ?? b.key_source_ref}</span>
                    <span
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      snapshot · {b.key_source_type}
                    </span>
                  </li>
                ))}
                {result.preserved_bindings.map((b) => (
                  <li
                    key={`pres-${b.upstream}`}
                    className="flex items-center gap-2"
                    style={{ color: 'var(--foreground)' }}
                  >
                    <span style={{ color: '#ca8a04' }}>{b.upstream}</span>
                    <span style={{ color: 'var(--muted-foreground)' }}>→</span>
                    <span>{b.key_source_label ?? b.key_source_ref}</span>
                    <span
                      className="text-[10px] uppercase tracking-wider"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      kept · {b.key_source_type}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Missing-upstream warning. The CLI register path is "success +
              warning" rather than "fail" so users get the token even when
              the binding isn't ready — they fix `aikey use` and the next
              request works. The UI must surface this loudly so the
              "agent returns BINDING_NOT_FOUND" outcome is obvious before
              it happens. */}
          {hasMissing ? (
            <div
              className="rounded border p-3"
              style={{
                background: 'rgba(250, 204, 21, 0.08)',
                borderColor: '#facc15',
              }}
            >
              <div
                className="font-mono text-[12px] uppercase tracking-wider mb-1"
                style={{ color: '#facc15' }}
              >
                ⚠ Missing default key for{' '}
                {result.missing_upstreams_for_aikey_use.join(', ')}
              </div>
              <p
                className="text-[12px]"
                style={{ color: 'var(--foreground)' }}
              >
                Your <code className="font-mono">aikey use</code> selection has no key
                for the upstream(s) above. The agent will receive a{' '}
                <code className="font-mono">BINDING_NOT_FOUND</code> error at request
                time until you pick a key. Fix it from the terminal
                (<code className="font-mono">aikey use</code>) or from this app's
                detail page (<span className="font-mono">Switch Key</span>).
              </p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 border-t flex items-center justify-end gap-2"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-[12px] font-mono uppercase tracking-wider"
            style={{
              background: '#ca8a04',
              color: 'var(--primary-foreground, #18181b)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
