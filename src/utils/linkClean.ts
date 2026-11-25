/**
 * Strips tracking query parameters from a web link before it is stored on a
 * task, a person, a reward and the rest (`cleanLinkUrl`).
 *
 * **A parameter is removed only when it is known to be tracking.** Whether
 * `?id=123` is a page or a campaign can't be told from the address, so
 * anything not listed stays: a wrongly stripped link is broken, a missed one
 * is only long. Two lists:
 *
 * - `GLOBAL_TRACKING`: names (and prefixes) that mean tracking on every site
 *   (`utm_*`, `fbclid`, `gclid`).
 * - `HOST_RULES`: names that are tracking only on one site (`si` on YouTube
 *   and Spotify, `ref` on Amazon). `ref`, `t`, `s`, `source` and `tag` are
 *   real content elsewhere, so they never go in the global list.
 *
 * Only `http(s)` links are touched, and a link with nothing to strip is
 * returned exactly as it was given (trimmed), so this is idempotent and never
 * reorders or re-encodes what it keeps. It works on the text rather than
 * through `URL`, whose `search` handling in Hermes is incomplete.
 */

const GLOBAL_TRACKING_NAMES = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'twclid', 'ttclid', 'yclid',
  'li_fat_id', 'epik', 'irclickid', 'srsltid', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', 'mkt_tok', 'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id', 'wickedid',
  'ml_subscriber', 'ml_subscriber_hash', 's_cid', 'sc_cid', 'cmpid', '_openstat', 'rb_clickid',
  '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  '_ga', '_gl', 'ref_src', 'ref_url', 'itsct', 'itscg',
  'pk_campaign', 'pk_kwd', 'pk_source', 'pk_medium', 'pk_content', 'piwik_campaign', 'piwik_kwd',
]);
const GLOBAL_TRACKING_PREFIXES = ['utm_', 'mtm_', 'matomo_'];

interface HostRule {
  /** Matches the host and every subdomain of it (`youtube.com` covers `m.youtube.com`). */
  hosts?: string[];
  /** For a site whose host varies by country (`amazon.co.uk`). */
  pattern?: RegExp;
  /** Parameter names to strip on these hosts, lowercase. */
  names?: string[];
  prefixes?: string[];
}

const AMAZON_HOST = /(^|\.)(amazon\.[a-z.]+|amzn\.com)$/;
const AMAZON_NAMES = ['ref', 'ref_', 'tag', 'qid', 'sr', 'keywords', 'crid', 'sprefix', 'linkcode', 'linkid', 'content-id', 'dib', 'dib_tag', 'pd_rd_i', 'th_ref'];

const HOST_RULES: HostRule[] = [
  { hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], names: ['si', 'feature', 'pp'] },
  { hosts: ['spotify.com', 'spotify.link'], names: ['si', 'nd', 'dlsi'] },
  { hosts: ['music.apple.com', 'podcasts.apple.com', 'itunes.apple.com', 'apps.apple.com'], names: ['ls', 'at', 'ct', 'mt', 'pt'] },
  { hosts: ['twitter.com', 'x.com'], names: ['s', 't'] },
  { hosts: ['reddit.com', 'redd.it'], names: ['share_id', 'ref', 'ref_source', 'rdt'] },
  { hosts: ['linkedin.com'], names: ['trk', 'trkinfo', 'originalsubdomain', 'rcm', 'lipi', 'midtoken', 'midsig', 'trackingid'] },
  { hosts: ['facebook.com', 'fb.com', 'fb.watch'], names: ['mibextid', 'rdid', 'sfnsn', '__tn__', 'share_url'], prefixes: ['__cft__'] },
  { hosts: ['google.com'], names: ['ved', 'ei', 'sxsrf', 'sca_esv', 'oq', 'gs_lcrp', 'gs_lp', 'sclient', 'sourceid', 'uact', 'iflsig', 'g_ep'] },
  { hosts: ['tiktok.com'], names: ['_r', '_t', 'is_from_webapp', 'sender_device', 'sender_web_id', 'share_app_id', 'share_link_id', 'share_item_id', 'u_code', 'tt_from', 'is_copy_url', 'checksum', 'social_sharing', 'enter_from', 'enter_method', 'refer'] },
  { hosts: ['ebay.com'], names: ['_trkparms', '_trksid', 'mkevt', 'mkcid', 'mkrid', 'campid', 'customid', 'toolid', 'siteid', 'ul_noapp', 'amdata', 'itmmeta'] },
  { hosts: ['nytimes.com'], names: ['smid', 'smtyp', 'referringsource', 'partner', 'ugrp'] },
  { pattern: AMAZON_HOST, names: AMAZON_NAMES, prefixes: ['pd_rd_', 'pf_rd_'] },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith('.' + domain);
}

function decodeName(raw: string): string {
  const name = raw.split('=')[0];
  try { return decodeURIComponent(name).toLowerCase(); } catch { return name.toLowerCase(); }
}

function isTrackingParam(host: string, rawName: string): boolean {
  const name = decodeName(rawName);
  if (GLOBAL_TRACKING_NAMES.has(name) || GLOBAL_TRACKING_PREFIXES.some(p => name.startsWith(p))) return true;
  return HOST_RULES.some(rule =>
    ((rule.hosts?.some(d => hostMatches(host, d)) ?? false) || (rule.pattern?.test(host) ?? false))
    && ((rule.names?.includes(name) ?? false) || (rule.prefixes?.some(p => name.startsWith(p)) ?? false)),
  );
}

/**
 * The link without its tracking parameters, or the link as given (trimmed)
 * when it is not an `http(s)` address or has none. Parameters that are kept
 * stay in their order and spelling; the fragment is kept.
 */
export function cleanLinkUrl(url: string): string {
  const trimmed = url.trim();
  const match = /^(https?:\/\/)([^/?#\s]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(trimmed);
  if (!match) return trimmed;
  const [, scheme, authority, rawPath, query = '', fragment = ''] = match;
  const host = authority.replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();

  // Amazon also carries its tracking as a path segment: /dp/B00X/ref=sr_1_1.
  const path = AMAZON_HOST.test(host)
    ? rawPath.replace(/\/ref=[^/]*/i, '')
    : rawPath;

  let keptQuery = query;
  if (query.length > 1) {
    const params = query.slice(1).split('&');
    const kept = params.filter(p => p === '' || !isTrackingParam(host, p));
    if (kept.length !== params.length) keptQuery = kept.length ? '?' + kept.join('&') : '';
  }

  if (path === rawPath && keptQuery === query) return trimmed;
  return scheme + authority + path + keptQuery + fragment;
}
