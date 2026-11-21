// Outlook / Microsoft 365 connection from the browser: MSAL.js sign-in (popup) and Microsoft Graph Mail.Read only.
// The app never asks for Mail.Send. Tokens stay in MSAL's sessionStorage cache; mail goes into IndexedDB.
// Needs an Azure app registration (SPA platform) — see docs/oauth-setup-guide.md.
import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from "@azure/msal-browser";
import { type ParsedMail, localIso } from "../../../../packages/engine/importers.ts";
import { clientId, redirectUri, validClientId } from "./outlook-config";

const SCOPES = ["Mail.Read"];

let app: PublicClientApplication | null = null;
let appFor = "";
async function msal() {
  const id = clientId();
  if (!validClientId(id)) throw new Error("Azure 앱의 클라이언트 ID(GUID)를 먼저 입력하세요.");
  if (!app || appFor !== id) {
    app = new PublicClientApplication({
      auth: { clientId: id, authority: "https://login.microsoftonline.com/common", redirectUri: redirectUri() },
      cache: { cacheLocation: "sessionStorage" },
    });
    await app.initialize();
    appFor = id;
  }
  return app;
}

async function token(): Promise<{ token: string; account: AccountInfo }> {
  const a = await msal();
  let account = a.getAllAccounts()[0];
  if (!account) account = (await a.loginPopup({ scopes: SCOPES, prompt: "select_account" })).account!;
  try {
    return { token: (await a.acquireTokenSilent({ scopes: SCOPES, account })).accessToken, account };
  } catch (e) {
    if (!(e instanceof InteractionRequiredAuthError)) throw e;
    return { token: (await a.acquireTokenPopup({ scopes: SCOPES, account })).accessToken, account };
  }
}

type GraphMail = {
  id: string; internetMessageId?: string; subject?: string; receivedDateTime?: string; hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  body?: { contentType?: string; content?: string };
};

const strip = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script").forEach((n) => n.remove());
  return (doc.body.innerText || doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
};

/** Reads the newest inbox mails (Mail.Read). limit caps how many are fetched in one go. */
export async function fetchInbox(limit = 200): Promise<{ account: string; mails: ParsedMail[] }> {
  const { token: tk, account } = await token();
  const mails: ParsedMail[] = [];
  let url: string | null = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc"
    + "&$select=id,internetMessageId,subject,receivedDateTime,hasAttachments,from,toRecipients,body";
  while (url && mails.length < limit) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${tk}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!res.ok) throw new Error(`Microsoft Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: { value: GraphMail[]; "@odata.nextLink"?: string } = await res.json();
    for (const g of data.value) {
      const body = g.body?.contentType === "html" ? strip(g.body.content ?? "") : (g.body?.content ?? "");
      mails.push({
        id: "graph:" + (g.internetMessageId || g.id), provider: "graph", subject: g.subject ?? "",
        senderName: g.from?.emailAddress?.name ?? "", senderEmail: (g.from?.emailAddress?.address ?? "").toLowerCase(),
        recipients: (g.toRecipients ?? []).map((r) => (r.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
        receivedAt: localIso(g.receivedDateTime ? new Date(g.receivedDateTime) : new Date()), bodyText: body.trim(), hasAttachment: !!g.hasAttachments, source: "Outlook",
      });
    }
    url = data["@odata.nextLink"] ?? null;
  }
  return { account: account.username, mails: mails.slice(0, limit) };
}

export async function signOut() {
  const a = await msal();
  const account = a.getAllAccounts()[0];
  if (account) await a.logoutPopup({ account });
}
