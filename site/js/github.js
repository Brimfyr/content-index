export const INDEX_REPOSITORY = "KSAModding/content-index";
// GitHub refused a link of about 5,900 characters while it forked the index for a new author (#110), so stay at the 2,000 that browsers and servers commonly accept.
export const URL_LIMIT = 2000;
export const PASTE_NEW = "The file is too long for the link. The button copies it, so paste it into the empty file on GitHub.";
export const PASTE_EDIT = "GitHub opens the old file. The button copies your new file, so replace the whole old file with it.";
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function listingPath(id) {
  return `listings/${id}.toml`;
}

export function rawListingUrl(id) {
  return `https://raw.githubusercontent.com/${INDEX_REPOSITORY}/main/${listingPath(encodeURIComponent(id))}`;
}

export function newFileUrl(id, text) {
  const base = `https://github.com/${INDEX_REPOSITORY}/new/main?filename=${listingPath(encodeURIComponent(id))}`;
  const filled = `${base}&value=${encodeURIComponent(text)}`;
  return filled.length <= URL_LIMIT ? { url: filled, filled: true } : { url: base, filled: false };
}

export function editUrl(id) {
  return `https://github.com/${INDEX_REPOSITORY}/edit/main/${listingPath(encodeURIComponent(id))}`;
}

export function pullRequestLink(id, text, baseId = null) {
  if (baseId) return { url: editUrl(baseId), step: PASTE_EDIT };
  const link = newFileUrl(id, text);
  return { url: link.url, step: link.filled ? "" : PASTE_NEW };
}

// The copy comes before the new tab, because the tab takes the focus and the
// browser refuses to write the clipboard for a page that does not have it.
export async function copyAndOpen(url, text, clipboard, open) {
  let copied = true;
  try {
    await clipboard.writeText(text);
  } catch {
    copied = false;
  }
  const tab = open(url);
  if (tab) tab.opener = null;
  return { copied, opened: Boolean(tab) };
}

export function repositoryApiUrl(repository) {
  return REPOSITORY.test(repository) ? `https://api.github.com/repos/${repository}` : null;
}

export function prefillFromRepository(answer) {
  const license = answer.license && answer.license.spdx_id;
  const htmlUrl = typeof answer.html_url === "string" ? answer.html_url : "";
  return {
    name: typeof answer.name === "string" ? answer.name : "",
    abstract: typeof answer.description === "string" ? answer.description.trim() : "",
    license: license && license !== "NOASSERTION" && license !== "OTHER" ? license : "",
    repository: htmlUrl,
    bugtracker: htmlUrl && answer.has_issues ? `${htmlUrl}/issues` : "",
    owner: answer.owner && typeof answer.owner.login === "string" ? answer.owner.login : "",
    organization: Boolean(answer.owner && answer.owner.type === "Organization"),
    fork: Boolean(answer.fork),
  };
}
