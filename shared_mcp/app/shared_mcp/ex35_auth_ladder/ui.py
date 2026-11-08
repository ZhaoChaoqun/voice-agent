"""Customer OTP console for Example 35, served by the pack at /ex35-otp.

The page and API follow the /otp console (docs/voice_agent/11_mcp_server/app/va_mcp/
otp_admin.py). Codes issued here are verified by verify_access_code on any
replica through the pack's shared OTP store. The console is open by default, like
the no-auth MCP routes; set EX35_OTP_ADMIN_TOKEN to require a bearer key.

The directory has about 20K fictional customers, so the page never loads it whole:
GET /api/customers?q=&offset=&limit= returns one page of spelling matches, plus
"sounds_like" customers from the phonetic name search when one is plugged in, and
GET /api/customers/<id> returns one profile.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
from urllib.parse import parse_qs
from typing import TYPE_CHECKING, Any, Awaitable, Callable

if TYPE_CHECKING:
    from .service import AuthLadderService

logger = logging.getLogger("shared_mcp.ex35_auth_ladder")

Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]

PREFIX = "/ex35-otp"
CUSTOMER_ID = re.compile(r"^[a-z0-9-]{1,64}$")
#: Typed text shorter than this (letters only) gets no phonetic suggestions.
SOUNDS_LIKE_MIN_LETTERS = 3
# Phonetic name search: typed text -> customer ids, best first.
NameSearch = Callable[[str], list[str]]


class OtpConsoleApp:
    def __init__(
        self,
        service: "AuthLadderService",
        admin_token: str | None = None,
        name_search: NameSearch | None = None,
    ) -> None:
        self._service = service
        self._name_search = name_search
        self._expected = f"Bearer {admin_token}".encode("utf-8") if admin_token else None

    async def __call__(self, scope: dict[str, Any], receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            return
        path = scope.get("path", "").rstrip("/") or "/"
        method = scope.get("method", "GET").upper()
        if path == PREFIX and method == "GET":
            await _respond(send, 200, UI_HTML.encode("utf-8"), b"text/html; charset=utf-8")
            return
        if path == f"{PREFIX}/api/customers" and method == "GET":
            if not self._authorized(scope):
                await _json(send, 401, {"error": "unauthorized"})
                return
            await _json(send, 200, self._directory_page(scope))
            return
        if path.startswith(f"{PREFIX}/api/customers/") and method == "GET":
            if not self._authorized(scope):
                await _json(send, 401, {"error": "unauthorized"})
                return
            candidate_id = path.rsplit("/", 1)[-1]
            try:
                if not CUSTOMER_ID.fullmatch(candidate_id):
                    raise LookupError(candidate_id)
                await _json(send, 200, self._service.customer_profile(candidate_id))
            except LookupError:
                await _json(send, 404, {"error": "unknown_customer"})
            return
        if path == f"{PREFIX}/api/otp" and method == "POST":
            if not self._authorized(scope):
                await _json(send, 401, {"error": "unauthorized"})
                return
            body = await _read_json(receive)
            if body is None:
                await _json(send, 400, {"error": "invalid_json"})
                return
            candidate_id = str(body.get("candidate_id", "")).strip()
            try:
                issued = self._service.issue_access_code(candidate_id)
            except LookupError:
                await _json(send, 404, {"error": "unknown_customer"})
                return
            except Exception:
                logger.exception("ex35 OTP issuance failed candidate_id=%s", candidate_id)
                await _json(send, 503, {"error": "otp_store_unavailable"})
                return
            await _json(send, 201, issued)
            return
        await _json(send, 404, {"error": "not found"})

    def _directory_page(self, scope: dict[str, Any]) -> dict[str, Any]:
        params = parse_qs((scope.get("query_string") or b"").decode("utf-8", "replace"))
        text = (params.get("q") or [""])[0][:120]
        offset = _int((params.get("offset") or ["0"])[0], 0)
        limit = _int((params.get("limit") or ["50"])[0], 50)
        page = self._service.search_directory(text, offset, limit)
        sounds_like: list[dict[str, Any]] = []
        letters = sum(ch.isalpha() for ch in text)
        # Hints help only when spelling finds nobody ("jung new", a misspelt surname);
        # next to spelling matches such as "mich" or "you meng" they only add noise.
        wanted = page["total"] == 0
        if self._name_search is not None and offset == 0 and letters >= SOUNDS_LIKE_MIN_LETTERS and wanted:
            try:
                ids = self._name_search(text)
            except Exception:
                logger.exception("ex35 console name search failed")
                ids = []
            shown = {customer["candidate_id"] for customer in page["customers"]}
            sounds_like = self._service.customer_summaries([cid for cid in ids if cid not in shown])
        return {**self._service.otp_directory(), **page, "sounds_like": sounds_like}

    def _authorized(self, scope: dict[str, Any]) -> bool:
        if self._expected is None:
            return True
        headers = dict(scope.get("headers") or [])
        return secrets.compare_digest(headers.get(b"authorization", b""), self._expected)


def _int(value: str, default: int) -> int:
    try:
        return int(value)
    except ValueError:
        return default


async def _read_json(receive: Receive) -> dict[str, Any] | None:
    body = bytearray()
    while True:
        message = await receive()
        if message.get("type") != "http.request":
            return None
        body.extend(message.get("body", b""))
        if len(body) > 4096:
            return None
        if not message.get("more_body", False):
            break
    try:
        value = json.loads(body or b"{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


async def _json(send: Send, status: int, value: dict[str, Any]) -> None:
    await _respond(send, status, json.dumps(value, separators=(",", ":")).encode("utf-8"), b"application/json")


async def _respond(send: Send, status: int, body: bytes, content_type: bytes) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", content_type),
                (b"cache-control", b"no-store"),
                (b"x-content-type-options", b"nosniff"),
                (b"x-frame-options", b"DENY"),
                (
                    b"content-security-policy",
                    b"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
                ),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


UI_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Example 35 Customer OTP Console</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;--ink:#f8f9ff;--muted:#a9b3d2;--line:rgba(255,255,255,.12);--panel:rgba(16,24,48,.82);--accent:#7788ff;--mint:#45d6b5}
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:42px 0;color:var(--ink);background:#09101f;overflow-x:hidden}body:before,body:after{content:"";position:fixed;width:42rem;height:42rem;border-radius:50%;filter:blur(100px);opacity:.22;pointer-events:none}body:before{background:#5367ff;top:-22rem;left:-15rem}body:after{background:#19bd9a;right:-18rem;bottom:-25rem}
main{position:relative;width:min(92vw,900px);margin:auto;padding:34px;border:1px solid var(--line);border-radius:28px;background:linear-gradient(145deg,rgba(25,34,65,.94),rgba(12,18,36,.9));box-shadow:0 30px 90px rgba(0,0,0,.5);backdrop-filter:blur(24px)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:25px}.mark{width:44px;height:44px;display:grid;place-items:center;border-radius:14px;background:linear-gradient(135deg,var(--accent),var(--mint));box-shadow:0 10px 32px rgba(90,110,255,.35)}.mark svg{width:23px}.eyebrow,.label{color:var(--mint);font-size:.72rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.brand strong{display:block;font-size:1.05rem;margin-top:3px}
h1{font-size:clamp(2rem,5vw,3rem);line-height:1.03;letter-spacing:-.045em;margin:0 0 12px;max-width:700px}p{color:var(--muted);line-height:1.55;margin:0 0 24px}.auth{display:flex;gap:10px;padding:7px;border:1px solid var(--line);border-radius:15px;background:rgba(3,7,18,.46)}input,select{min-width:0;flex:1;border:0;outline:0;color:var(--ink);background:transparent;padding:12px 13px;font-size:.96rem}select{width:100%;border:1px solid var(--line);border-radius:13px;background:#111a34}button{border:0;border-radius:11px;padding:12px 18px;font-weight:780;color:white;background:linear-gradient(135deg,#6879ff,#765cff);cursor:pointer;box-shadow:0 8px 22px rgba(93,86,255,.28);transition:.2s}button:hover{transform:translateY(-1px);filter:brightness(1.08)}button:disabled{opacity:.5;cursor:wait;transform:none}
.error{min-height:21px;color:#ff9aa8;font-size:.86rem;margin:10px 2px}.workspace{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.75fr);gap:18px;margin-top:12px}.panel{padding:20px;border:1px solid var(--line);border-radius:19px;background:var(--panel)}.panel h2{font-size:1rem;margin:0 0 14px}.tests{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;background:linear-gradient(110deg,rgba(69,214,181,.12),rgba(16,24,48,.82))}.test{padding:13px 15px;border:1px solid rgba(69,214,181,.25);border-radius:12px;background:rgba(3,7,18,.42)}.test span{display:block;color:var(--muted);font-size:.72rem;margin-bottom:5px}.test strong{display:block;font:800 1.08rem/1.3 ui-monospace,SFMono-Regular,monospace;letter-spacing:.1em;color:#dffcf5}.test em{display:block;font-style:normal;font-size:.82rem;margin-top:4px}.profile{margin-top:16px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.datum{padding:12px;border-radius:12px;background:rgba(255,255,255,.045)}.datum span{display:block;color:var(--muted);font-size:.72rem;margin-bottom:5px}.datum strong{font-size:.98rem}.issue{width:100%;margin-top:16px;padding:14px}.notice{font-size:.75rem;color:#7f8aa9;margin:13px 2px 0;line-height:1.45}
.result{text-align:center;border-color:rgba(69,214,181,.25);background:linear-gradient(160deg,rgba(37,133,116,.18),rgba(19,29,54,.82));animation:up .25s ease-out}.code{font:800 clamp(1.9rem,5vw,2.7rem)/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.16em;margin:15px 0 10px}.meta{font-size:.84rem;color:var(--muted);line-height:1.55}.copy{margin-top:18px;background:transparent;border:1px solid var(--line);box-shadow:none}.empty{display:grid;place-items:center;min-height:230px;color:var(--muted);text-align:center}.foot{display:flex;gap:8px;align-items:center;margin-top:24px;color:#7f89a6;font-size:.77rem}.dot{width:7px;height:7px;border-radius:50%;background:var(--mint);box-shadow:0 0 12px var(--mint)}[hidden]{display:none!important}@keyframes up{from{opacity:0;transform:translateY(8px)}}
@media(max-width:720px){main{padding:25px}.workspace{grid-template-columns:1fr}.auth{flex-direction:column}.auth button{width:100%}.profile{grid-template-columns:1fr 1fr}}@media(max-width:440px){.profile{grid-template-columns:1fr}.code{letter-spacing:.1em}}
.combo{position:relative;display:flex;align-items:center;border:1px solid var(--line);border-radius:13px;background:#111a34}.combo:focus-within{border-color:rgba(119,136,255,.7)}.toggle{flex:none;background:transparent;box-shadow:none;padding:10px 14px;color:var(--muted);font-size:.9rem}.options{position:absolute;left:0;right:0;top:calc(100% + 6px);max-height:340px;overflow:auto;z-index:5;border:1px solid var(--line);border-radius:13px;background:#0d1530;box-shadow:0 18px 50px rgba(0,0,0,.55)}.opt{display:flex;justify-content:space-between;gap:12px;padding:9px 13px;cursor:pointer}.opt small{color:var(--muted);white-space:nowrap}.opt.active,.opt:hover{background:rgba(119,136,255,.2)}.group{padding:10px 13px 4px;font-size:.66rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--mint)}.more{padding:9px 13px 12px;color:var(--muted);font-size:.78rem}.count{color:var(--muted);font-size:.78rem;margin:8px 2px 0}mark{background:none;color:#dffcf5;font-weight:800}
</style>
</head>
<body><main>
<div class="brand"><div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></div><div><span class="eyebrow">Example 35 &middot; Contoso Bank</span><strong>Customer OTP Console</strong></div></div>
<h1>Generate a customer access code.</h1><p>Find any fictional customer by typing part of their name, or open the list to browse everyone. Generate an 8-digit code and read it to the Agent in the one-time code check: the code itself tells the Agent who you are.</p>
<div class="auth" id="auth" hidden><input id="key" type="password" autocomplete="current-password" placeholder="Administrator access key" aria-label="Administrator access key"><button id="unlock">Unlock directory</button></div>
<div class="error" id="error" role="alert"></div>
<section class="workspace" id="workspace" hidden>
    <div class="panel tests" id="tests"></div>
    <div class="panel"><h2>Select fictional customer</h2><div class="combo"><input id="search" role="combobox" aria-label="Fictional customer" aria-controls="options" aria-expanded="false" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type part of a name, or open the list"><button class="toggle" id="toggle" type="button" tabindex="-1" aria-label="Show all customers">&#9662;</button><div class="options" id="options" role="listbox" hidden></div></div><div class="count" id="count"></div><div class="profile" id="profile"></div><div class="notice">Synthetic test data only. In the call, choose the one-time code check and read this code; it works once and identifies this customer.</div><button class="issue" id="generate">Generate customer OTP</button></div>
    <div class="panel empty" id="empty"><span>Select a customer, then generate a one-time code.</span></div>
    <div class="panel result" id="result" hidden aria-live="polite"><div class="label">One-time code</div><div class="code" id="code"></div><div class="meta" id="meta"></div><button class="copy" id="copy">Copy code</button></div>
</section>
<div class="foot"><span class="dot"></span><span>Codes expire after 48 hours and work once. Generating again replaces only that customer's previous active code.</span></div>
</main>
<script>
const q=s=>document.querySelector(s),key=q('#key'),unlock=q('#unlock'),authBox=q('#auth'),workspace=q('#workspace'),search=q('#search'),options=q('#options'),toggle=q('#toggle'),count=q('#count'),profile=q('#profile'),generate=q('#generate'),result=q('#result'),empty=q('#empty'),error=q('#error'),code=q('#code'),meta=q('#meta'),tests=q('#tests');
const API='/ex35-otp/api',PAGE=50;const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);const auth=()=>key.value?{'Authorization':'Bearer '+key.value}:{};
let info=null,current=null,query='',page=[],sounds=[],total=0,loading=false,seq=0,timer=0,items=[],active=-1;
function fail(message){error.textContent=message}
function box(cls,label,value,extra){const d=document.createElement('div');d.className=cls;const s=document.createElement('span');s.textContent=label;const b=document.createElement('strong');b.textContent=value;d.append(s,b);if(extra){const e=document.createElement('em');e.textContent=extra;d.append(e)}return d}
async function api(path){const r=await fetch(API+path,{headers:auth()});if(r.status===401){authBox.hidden=false;workspace.hidden=true;if(key.value)fail('The administrator access key is not valid.');throw new Error('locked')}const body=await r.json();if(!r.ok)throw new Error(r.status===404?'That customer no longer exists.':'The customer directory is unavailable.');return body}
const listPath=(text,offset)=>'/customers?'+new URLSearchParams({q:text,offset:String(offset),limit:String(PAGE)});
function isOpen(){return !options.hidden}
function open(){options.hidden=false;search.setAttribute('aria-expanded','true')}
function close(){options.hidden=true;search.setAttribute('aria-expanded','false');active=-1;if(current)search.value=current.full_name}
async function fetchPage(reset){if(loading&&!reset)return;const mine=++seq;loading=true;try{const body=await api(listPath(query,reset?0:page.length));if(mine!==seq)return;if(reset){page=body.customers;sounds=body.sounds_like||[];options.scrollTop=0;active=-1}else{page=page.concat(body.customers)}total=body.total;draw()}catch(e){if(e.message!=='locked')fail(e.message)}finally{if(mine===seq)loading=false}}
function highlight(el,name){const words=query.toLowerCase().match(/[a-z0-9]+/g)||[];if(!words.length){el.textContent=name;return}const re=new RegExp('\\\\b('+words.map(w=>w.replace(/[^a-z0-9]/g,'')).join('|')+')','gi');let last=0;name.replace(re,(m,_,i)=>{el.append(name.slice(last,i));const k=document.createElement('mark');k.textContent=m;el.append(k);last=i+m.length;return m});el.append(name.slice(last))}
function row(c,i){const d=document.createElement('div');d.className='opt'+(i===active?' active':'');d.id='opt-'+i;d.setAttribute('role','option');const n=document.createElement('span');highlight(n,c.full_name);const s=document.createElement('small');s.textContent=(c.candidate_id===info.default_candidate_id?'default call \u00b7 ':'')+c.state;d.append(n,s);d.onmousedown=e=>e.preventDefault();d.onclick=()=>choose(c);return d}
function group(text){const g=document.createElement('div');g.className='group';g.textContent=text;return g}
function draw(){items=[...sounds,...page];const nodes=[];let i=0;if(sounds.length){nodes.push(group('Sounds like \u00b7 phonetic name search'));for(const c of sounds)nodes.push(row(c,i++))}if(query.trim())nodes.push(group(page.length?'Spelled like \u00b7 '+total.toLocaleString()+' match'+(total===1?'':'es'):'Spelled like \u00b7 no match'));else nodes.push(group('All customers \u00b7 '+total.toLocaleString()));for(const c of page)nodes.push(row(c,i++));if(page.length<total){const m=document.createElement('div');m.className='more';m.textContent='Showing '+page.length.toLocaleString()+' of '+total.toLocaleString()+' \u00b7 scroll for more, or keep typing';nodes.push(m)}options.replaceChildren(...nodes);if(active>=0)search.setAttribute('aria-activedescendant','opt-'+active);else search.removeAttribute('aria-activedescendant')}
function move(step){if(!items.length)return;active=(active+step+items.length)%items.length;draw();const el=q('#opt-'+active);if(el)el.scrollIntoView({block:'nearest'})}
async function choose(c){close();search.value=c.full_name;await showProfile(c.candidate_id)}
async function showProfile(id){fail('');try{current=await api('/customers/'+encodeURIComponent(id));search.value=current.full_name;render()}catch(e){if(e.message!=='locked')fail(e.message)}}
function render(){const c=current;if(!c)return;const dob=new Date(c.date_of_birth+'T00:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});const fields=[['Date of birth',dob],['Phone on file',c.phone_masked],['Account',c.account_type+' '+c.account_masked],['Customer since',c.customer_since],['Checking',money(c.balances_usd.checking)],['Savings',money(c.balances_usd.savings)],['Credit tier',c.credit_tier],['State',c.state]];profile.replaceChildren(...fields.map(([l,v])=>box('datum',l,v)));generate.textContent='Generate OTP for '+c.full_name;result.hidden=true;empty.hidden=false}
function browse(){query='';open();fetchPage(true)}
search.onfocus=()=>{search.select();browse()};search.onclick=()=>{if(!isOpen()){search.select();browse()}};
search.oninput=()=>{query=search.value;open();clearTimeout(timer);timer=setTimeout(()=>fetchPage(true),150)};
search.onblur=()=>setTimeout(close,120);
search.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();if(!isOpen())browse();else move(1)}else if(e.key==='ArrowUp'){e.preventDefault();move(-1)}else if(e.key==='Enter'){e.preventDefault();const c=items[active>=0?active:0];if(isOpen()&&c)choose(c)}else if(e.key==='Escape'){close();search.blur()}};
toggle.onmousedown=e=>e.preventDefault();toggle.onclick=()=>{if(isOpen())close();else{search.focus()}};
options.onscroll=()=>{if(page.length<total&&options.scrollTop+options.clientHeight>options.scrollHeight-60)fetchPage(false)};
async function load(){fail('');unlock.disabled=true;try{const body=await api(listPath('',0));info=body;tests.replaceChildren(...body.test_codes.map(t=>box('test','Permanent access code',t.code,t.full_name)),box('test','Test text-message code',body.test_sms_code,'Any customer'));count.textContent=body.total_customers.toLocaleString()+' fictional customers \u00b7 type any part of a name, or a spelling that sounds like it';authBox.hidden=true;workspace.hidden=false;await showProfile(body.default_candidate_id)}catch(e){if(e.message!=='locked'){workspace.hidden=true;fail(e.message)}}finally{unlock.disabled=false}}
unlock.onclick=load;
generate.onclick=async()=>{const customer=current;if(!customer)return;fail('');generate.disabled=true;generate.textContent='Generating...';try{const r=await fetch(API+'/otp',{method:'POST',headers:{...auth(),'Content-Type':'application/json'},body:JSON.stringify({candidate_id:customer.candidate_id})});const body=await r.json();if(!r.ok)throw new Error(r.status===401?'Administrator access expired.':r.status===404?'That customer no longer exists.':'The OTP service is temporarily unavailable.');code.textContent=body.otp;meta.textContent='For '+body.customer.full_name+' - expires in '+Math.round(body.expires_in_seconds/3600)+' hours';empty.hidden=true;result.hidden=false}catch(e){fail(e.message)}finally{generate.disabled=false;generate.textContent='Generate OTP for '+customer.full_name}};
q('#copy').onclick=async e=>{await navigator.clipboard.writeText(code.textContent);e.target.textContent='Copied';setTimeout(()=>e.target.textContent='Copy code',1400)};key.addEventListener('keydown',e=>{if(e.key==='Enter')load()});load();
</script></body></html>"""
