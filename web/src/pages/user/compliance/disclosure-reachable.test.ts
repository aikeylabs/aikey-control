/**
 * 🔴 The mandated privacy disclosure must stay RENDERED, not merely present in
 * the i18n catalog.
 *
 * `shared/i18n/privacy-claim-scope.test.ts` (2026-08-11) pins the CONTENT of
 * `compliancePage.pageDescription` — that it discloses the snippet upload, the
 * default-on install, the org-owned destination, and the separate conversation
 * -audit lane. What it cannot see is whether the page still puts that string on
 * screen: it reads JSON, not JSX.
 *
 * On 2026-09-04 the header was shortened to one line at the user's request and
 * the full text moved into an InfoHint beside the title. That is a legitimate
 * change — the notice is one click away rather than deleted. But it opens a
 * failure mode with no fence: delete the hint, and the catalog fence stays
 * GREEN while the disclosure vanishes from the product. This file closes that
 * gap from the render side.
 *
 * 能红: remove the InfoHint from index.tsx (or swap it to the short key) and
 * this file turns red — after the 2026-09-04 change the hint is the ONLY place
 * `source.descriptionKey` is rendered.
 *
 * spec: R-compliance-local-ledger-completeness-3
 * bugfix: workflow/CI/bugfix/2026-09-04-page-header-actions-squeezed-by-long-description.md
 */
// @ts-nocheck — vitest-only test file using Node built-ins. Same pragma
// rationale as pages/user/no-silent-query-errors.test.ts: the web app
// deliberately does not depend on @types/node, so a test that reads source
// files off disk cannot type-check without it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGE = path.join(process.cwd(), 'src/pages/user/compliance/index.tsx');
const src = fs.readFileSync(PAGE, 'utf-8');

describe('compliance disclosure reachability', () => {
  it('🔴 renders the FULL descriptionKey somewhere on the page', () => {
    expect(
      src,
      'the mandated privacy disclosure (source.descriptionKey) is no longer rendered — ' +
        'shortening the header is fine, dropping the notice is not. Keep it in the ' +
        'InfoHint beside the title, or put it back in the header description.',
    ).toMatch(/t\(source\.descriptionKey\)/);
  });

  it('🔴 when a short headline is used, the full text is in a title hint', () => {
    // The short key only earns its place if the long one moved somewhere real.
    if (!/descriptionShortKey\s*\?\?/.test(src)) return; // header still shows the full text
    expect(src, 'a short header without an InfoHint carrying the full disclosure').toMatch(
      /titleHint=\{[\s\S]{0,400}?InfoHint[\s\S]{0,400}?t\(source\.descriptionKey\)/,
    );
  });

  it('🔴 the local lane declares the short headline key it actually ships', () => {
    expect(src).toMatch(/descriptionShortKey:\s*'compliancePage\.pageDescriptionShort'/);
  });
});
