
var SERVER_URL = "";
var currentUser = null;
var isAdmin = false;
var pollTimer = null;
var statusTimer = null;
var guestQuota = {remaining: 3, limit: 3, used: 0};
var TIER_COLORS = {free:"var(--t-free)",bronze:"var(--t-bronze)",silver:"var(--t-silver)",gold:"var(--t-gold)",supreme:"var(--t-supreme)"};
var TIER_LABELS = {free:"Free",bronze:"Bronze",silver:"Silver",gold:"Gold",supreme:"Supreme"};
var TIER_LIMITS = {free:"1 GB",bronze:"2 GB",silver:"5 GB",gold:"10 GB",supreme:"Unlimited"};
var TIER_DAILY = {free:"5/24h",bronze:"10/24h",silver:"25/24h",gold:"50/24h",supreme:"Unlimited"};
var TIER_PLATFORMS = {
  guest:["YouTube"],
  free:["YouTube"],
  bronze:["YouTube","Instagram","TikTok","Facebook"],
  silver:["YouTube","Instagram","TikTok","Facebook","Twitter/X","Reddit","Vimeo"],
  gold:["YouTube","Instagram","TikTok","Facebook","Twitter/X","Reddit","Vimeo","Dailymotion","SoundCloud","Pinterest"],
  supreme:"all"
};
var DONATION_DISMISSED = false;

function toast(msg, type){
  var t = document.createElement("div");
  t.className = "toast " + (type||"");
  t.textContent = msg;
  document.getElementById("toasts").appendChild(t);
  setTimeout(function(){ t.style.opacity="0"; t.style.transition="opacity .3s"; setTimeout(function(){ t.remove(); },300); },4000);
}

function api(path, method, body){
  var opts = {method:method||"GET",headers:{"Content-Type":"application/json"},credentials:"include"};
  if(body) opts.body = JSON.stringify(body);
  /* 30s timeout — server should respond quickly (probe moved to background) */
  var ctrl = new AbortController();
  opts.signal = ctrl.signal;
  var timer = setTimeout(function(){ ctrl.abort(); }, 30000);
  return fetch(SERVER_URL + path, opts).then(function(r){
    clearTimeout(timer);
    if(r.status === 401) return {error:"auth_required"};
    return r.json().catch(function(){return {error:"Could not reach server. It may be restarting — try again in a moment."}});
  }).catch(function(err){
    clearTimeout(timer);
    if(err.name === "AbortError") return {error:"Request timed out. Server may be busy or restarting — try again."};
    return {error:"Could not reach server. It may be offline or restarting."};
  });
}

function loadServerStatus(){
  var rawUrl = "https://raw.githubusercontent.com/ytdownloadweb/WZML-X-Bot/main/tunnel-status.js?t=" + Date.now();
  fetch(rawUrl).then(function(r){return r.text();}).then(function(txt){
    var m = txt.match(/window\.tunnelStatus\s*=\s*(\{[^}]+\})/);
    if(m){
      try{
        var data = JSON.parse(m[1]);
        if(data.status === "online" && data.url){
          SERVER_URL = data.url;
          var b = document.getElementById("statusBadge");
          b.className = "status-badge online";
          document.getElementById("statusText").textContent = "Online";
          fetch(data.url + "/ping").then(function(r){return r.json();}).then(function(d){
            if(!d.ok){
              document.getElementById("statusBadge").className = "status-badge offline";
              document.getElementById("statusText").textContent = "Server Down";
            }
          }).catch(function(){});
        } else { showOffline(); }
      }catch(e){ showOffline(); }
    } else { showOffline(); }
  }).catch(function(){ showOffline(); });
}
function showOffline(){
  var b = document.getElementById("statusBadge");
  b.className = "status-badge offline";
  document.getElementById("statusText").textContent = "Offline";
}

/* ---- Guest quota from server ---- */
function loadGuestQuota(){
  if(!SERVER_URL){ setTimeout(loadGuestQuota, 3000); return; }
  api("/api/guest-quota","GET").then(function(d){
    if(d && typeof d.remaining !== "undefined"){
      guestQuota = d;
      updateGuestBanner();
    }
  }).catch(function(){});
}
function updateGuestBanner(){
  if(currentUser) return;
  var el = document.getElementById("guestLimit");
  var banner = document.getElementById("guestBanner");
  if(el && banner){
    var left = guestQuota.remaining;
    el.textContent = left + " download" + (left !== 1 ? "s" : "") + " left (resets in 24h)";
    banner.style.display = "flex";
  }
}

/* ---- Auth (non-blocking) ---- */
function tryAuth(){
  if(!SERVER_URL){ setTimeout(tryAuth, 3000); return; }
  api("/api/auth/me","GET").then(function(d){
    if(d && d.username){
      currentUser = d;
      isAdmin = d.isAdmin;
      onLoggedIn(d);
    } else {
      onGuest();
    }
  }).catch(function(){ onGuest(); });
}

function onGuest(){
  currentUser = null; isAdmin = false;
  document.getElementById("authBtn").style.display = "";
  document.getElementById("authBtn").textContent = "Sign In";
  document.getElementById("logoutTopBtn").style.display = "none";
  document.getElementById("tierBadge").style.display = "none";
  document.getElementById("adminNavBtn").style.display = "none";
  document.getElementById("adminBottomBtn").style.display = "none";
  document.getElementById("guestBanner").style.display = "flex";
  document.getElementById("historyNote").textContent = "Sign in to track history.";
  document.getElementById("profileGrid").innerHTML = '<div class="empty">Not signed in. Click "Sign In" to view profile.</div>';
  loadPremium();
  loadGuestQuota();
}

function onLoggedIn(user){
  currentUser = user;
  document.getElementById("authBtn").style.display = "none";
  document.getElementById("logoutTopBtn").style.display = "";
  document.getElementById("guestBanner").style.display = "none";
  var tb = document.getElementById("tierBadge");
  tb.textContent = TIER_LABELS[user.tier] || user.tier;
  tb.style.color = TIER_COLORS[user.tier] || "var(--muted)";
  tb.style.display = "inline-flex";
  if(user.isAdmin){
    document.getElementById("adminNavBtn").style.display = "inline-block";
    document.getElementById("adminBottomBtn").style.display = "flex";
  }
  api("/log","POST",{event:"visit",user:user.username}).catch(function(){});
  loadHistory();
  loadProfile(user);
  loadPremium();
  if(user.isAdmin) loadAdmin();
}

function logout(){
  api("/api/auth","POST",{action:"logout"}).then(function(){
    currentUser = null; isAdmin = false;
    onGuest();
    switchScreen("downloader");
    toast("Logged out","success");
  }).catch(function(){ toast("Network error","error"); });
}

function switchScreen(name){
  document.querySelectorAll(".screen").forEach(function(s){ s.classList.remove("active"); });
  var el = document.getElementById(name + "Screen");
  if(el) el.classList.add("active");
  document.querySelectorAll(".nav-btn,.bottom-nav .b").forEach(function(b){
    if(b.dataset.screen === name) b.classList.add("active");
    else b.classList.remove("active");
  });
  if(name === "history") loadHistory();
  if(name === "admin") loadAdmin();
  if(name === "profile" && currentUser) loadProfile(currentUser);
}

/* ---- Login modal ---- */
function openLoginModal(){
  document.getElementById("loginModal").classList.add("show");
}
function closeLoginModal(){
  document.getElementById("loginModal").classList.remove("show");
}

/* ---- Donation popup ---- */
function showDonatePopup(stage){
  if(DONATION_DISMISSED) return;
  var title = document.getElementById("donateTitle");
  var text = document.getElementById("donateText");
  if(stage === "start"){
    title.textContent = "Your download has started!";
    text.innerHTML = "While you wait, consider supporting the developer.<br>Donors get extended support and direct chat access!";
  } else if(stage === "complete"){
    title.textContent = "Download complete! 🎉";
    text.innerHTML = "If this saved you time, consider donating to support the server costs.<br>Donors get extended support and direct chat access!";
  }
  document.getElementById("donateModal").classList.add("show");
}

function copyUPI(){
  var upi = "sandeepjoshi0085@okaxis";
  try{
    navigator.clipboard.writeText(upi);
    toast("UPI ID copied to clipboard!","success");
  }catch(e){
    // Fallback
    var ta = document.createElement("textarea");
    ta.value = upi;
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); toast("UPI ID copied!","success"); }catch(e2){ toast("UPI: sandeepjoshi0085@okaxis","info"); }
    document.body.removeChild(ta);
  }
}

/* ---- Platform detection ---- */
function detectPlatform(url){
  var u = url.toLowerCase();
  var map = [
    [["youtube.com","youtu.be","m.youtube.com"],"YouTube"],
    [["instagram.com","instagr.am"],"Instagram"],
    [["tiktok.com"],"TikTok"],
    [["facebook.com","fb.watch","m.facebook.com"],"Facebook"],
    [["twitter.com","x.com","t.co"],"Twitter/X"],
    [["reddit.com","redd.it"],"Reddit"],
    [["vimeo.com"],"Vimeo"],
    [["dailymotion.com","dai.ly"],"Dailymotion"],
    [["soundcloud.com"],"SoundCloud"],
    [["pinterest.com","pin.it"],"Pinterest"],
    [["streamable.com"],"Streamable"],
    [["twitch.tv"],"Twitch"]
  ];
  for(var i=0;i<map.length;i++){
    for(var j=0;j<map[i][0].length;j++){
      if(u.indexOf(map[i][0][j]) >= 0) return map[i][1];
    }
  }
  return "Unknown";
}

/* ---- Clipboard paste ---- */
function pasteFromClipboard(){
  try{
    navigator.clipboard.readText().then(function(text){
      if(text && text.length > 5){
        var input = document.getElementById("urlInput");
        input.value = text.trim();
        input.dispatchEvent(new Event("input"));
        toast("Pasted from clipboard","success");
      } else {
        toast("Clipboard is empty","info");
      }
    }).catch(function(){
      toast("Clipboard access denied. Paste manually.","info");
    });
  }catch(e){
    toast("Clipboard not supported","info");
  }
}

/* ---- Download ---- */
function startDownload(){
  var url = document.getElementById("urlInput").value.trim();
  if(!url || url.length < 10){ toast("Enter a valid URL","error"); return; }
  /* Client-side URL validation — bypass proof */
  try{
    var parsed = new URL(url);
    if(parsed.protocol !== "http:" && parsed.protocol !== "https:"){
      toast("Only http/https URLs are allowed","error"); return;
    }
  }catch(e){
    toast("Invalid URL format","error"); return;
  }
  if(!SERVER_URL){ toast("Server is offline. Please wait.","error"); return; }

  var platform = detectPlatform(url);
  /* Client-side platform check — saves a round trip if tier doesn't support it */
  var userTier = currentUser ? currentUser.tier : "guest";
  var allowed = TIER_PLATFORMS[userTier];
  if(allowed !== "all" && platform !== "Unknown" && allowed.indexOf(platform) < 0){
    var tw = document.getElementById("tierWarn");
    tw.innerHTML = "Your " + (userTier === "guest" ? "Guest" : userTier.charAt(0).toUpperCase()+userTier.slice(1)) + " tier does not support " + platform + ".<br>Allowed: " + allowed.join(", ") + "<br><br><a href=\"https://t.me/DJ_Hackrr\" target=\"_blank\" style=\"color:var(--accent2);font-weight:600\">Contact @DJ_Hackrr on Telegram to upgrade</a>";
    tw.style.display = "block";
    toast(platform + " not available on your tier","warn");
    return;
  }
  var hint = document.getElementById("platformHint");
  hint.style.display = "flex";
  hint.innerHTML = '<span class="platform-tag">' + platform + '</span> detected';
  document.getElementById("dlBtn").disabled = true;
  document.getElementById("dlBtn").textContent = "Starting…";
  document.getElementById("tierWarn").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("progressWrap").style.display = "block";
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("progressStage").textContent = "Starting…";
  document.getElementById("progressPct").textContent = "0%";

  var fmt = document.getElementById("fmtSelect") ? document.getElementById("fmtSelect").value : "mp4";
  var quality = document.getElementById("qualitySelect") ? document.getElementById("qualitySelect").value : "1080";
  api("/api/download","POST",{url:url,format:fmt,quality:quality}).then(function(d){
    if(d.error){
      document.getElementById("progressWrap").style.display = "none";
      document.getElementById("dlBtn").disabled = false;
      document.getElementById("dlBtn").textContent = "Download";
      if(d.error === "auth_required"){
        toast("Sign in required to download. Click Sign In!","warn");
        openLoginModal();
      } else if(d.error.indexOf("limit reached") >= 0 || d.error.indexOf("limit") >= 0){
        var tw = document.getElementById("tierWarn");
        tw.innerHTML = d.error + '<br><br><a href="https://t.me/DJ_Hackrr" target="_blank" style="color:var(--accent2);font-weight:600">Contact @DJ_Hackrr on Telegram to upgrade ➜</a>';
        tw.style.display = "block";
        toast(d.error,"warn");
      } else { toast(d.error,"error"); }
      return;
    }
    if(d.job_id){
      /* Show donation popup on download start for guests and free users */
      if(!currentUser || currentUser.tier === "free"){
        setTimeout(function(){ showDonatePopup("start"); }, 1500);
      }
      pollDownload(d.job_id);
    }
  }).catch(function(err){
    /* Show the actual error from server, not just "Network error" */
    var msg = (err && err.error) ? err.error : "Could not start download. Server may be restarting.";
    toast(msg, "error");
    document.getElementById("dlBtn").disabled = false;
    document.getElementById("dlBtn").textContent = "Download";
    document.getElementById("progressWrap").style.display = "none";
  });
}

function pollDownload(jobId){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function(){
    api("/api/status/" + jobId, "GET").then(function(d){
      if(!d || d.error) return;
      var pct = d.progress || 0;
      document.getElementById("progressFill").style.width = pct + "%";
      document.getElementById("progressPct").textContent = Math.round(pct) + "%";
      document.getElementById("progressStage").textContent = d.message || "Processing…";
      if(d.status === "done"){
        clearInterval(pollTimer); pollTimer = null;
        document.getElementById("dlBtn").disabled = false;
        document.getElementById("dlBtn").textContent = "Download";
        document.getElementById("progressFill").style.width = "100%";
        document.getElementById("progressPct").textContent = "100%";
        document.getElementById("progressStage").textContent = "Complete!";
        var rc = document.getElementById("resultCard");
        rc.style.display = "flex";
        document.getElementById("resultName").textContent = d.filename || "Download complete";
        var sizeMB = d.filesize ? (d.filesize > 1073741824 ? (d.filesize/1073741824).toFixed(1)+" GB" : (d.filesize/1048576).toFixed(1)+" MB") : "";
        document.getElementById("resultMeta").textContent = sizeMB;
        var link = document.getElementById("resultLink");
        if(d.cloud_link){ link.href = d.cloud_link; link.style.display = "inline-flex"; }
        else { link.style.display = "none"; }
        toast("Download complete!","success");
        if(!currentUser) loadGuestQuota();
        if(currentUser) loadHistory();
        /* Show donation popup on completion for guests and free users */
        if(!currentUser || currentUser.tier === "free"){
          showDonatePopup("complete");
        }
      } else if(d.status === "error"){
        clearInterval(pollTimer); pollTimer = null;
        document.getElementById("dlBtn").disabled = false;
        document.getElementById("dlBtn").textContent = "Download";
        document.getElementById("progressWrap").style.display = "none";
        toast(d.message || "Download failed","error");
      }
    }).catch(function(){});
  }, 2000);
}

/* ---- History ---- */
function loadHistory(){
  if(!currentUser){
    document.getElementById("historyList").innerHTML = '<div class="empty">Sign in to track your download history.</div>';
    return;
  }
  api("/api/history","GET").then(function(d){
    var el = document.getElementById("historyList");
    if(!d || d.error || !d.length){
      el.innerHTML = '<div class="empty">No downloads yet. Your history will appear here.</div>';
      return;
    }
    var html = '<table><thead><tr><th>File</th><th>Platform</th><th>Size</th><th>Date</th><th>Link</th></tr></thead><tbody>';
    d.forEach(function(item){
      var size = item.size ? (item.size > 1073741824 ? (item.size/1073741824).toFixed(1)+" GB" : (item.size/1048576).toFixed(1)+" MB") : "—";
      var date = new Date(item.date).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
      var link = item.link ? '<a href="'+item.link+'" target="_blank">Open ➜</a>' : '—';
      html += '<tr><td>'+escapeHtml(item.title||"")+'</td><td>'+escapeHtml(item.platform||"")+'</td><td>'+size+'</td><td>'+date+'</td><td>'+link+'</td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }).catch(function(){
    document.getElementById("historyList").innerHTML = '<div class="empty">Failed to load history.</div>';
  });
}

/* ---- Profile ---- */
function loadProfile(user){
  if(!user){ return; }
  var html = '';
  html += '<div class="stat-box"><div class="label">Username</div><div class="value">'+escapeHtml(user.username)+'</div></div>';
  html += '<div class="stat-box"><div class="label">Tier</div><div class="value" style="color:'+(TIER_COLORS[user.tier]||"var(--text)")+'">'+(TIER_LABELS[user.tier]||user.tier)+'</div></div>';
  html += '<div class="stat-box"><div class="label">Max File</div><div class="value">'+(TIER_LIMITS[user.tier]||"—")+'</div></div>';
  html += '<div class="stat-box"><div class="label">Quota / 24h</div><div class="value">'+(TIER_DAILY[user.tier]||"—")+'</div></div>';
  document.getElementById("profileGrid").innerHTML = html;
  document.getElementById("historyNote").textContent = "";
}

/* ---- Premium tiers ---- */
function loadPremium(){
  var tiers = [
    {key:"guest",name:"Guest",price:"₹0",features:["1 GB max file","3 downloads/24h","All platforms"]},
    {key:"free",name:"Free",price:"₹0",features:["1 GB max file","5 downloads/24h","All platforms","Download history"]},
    {key:"bronze",name:"Bronze",price:"₹99/mo",features:["2 GB max file","10 downloads/24h","All platforms"]},
    {key:"silver",name:"Silver",price:"₹199/mo",features:["5 GB max file","25 downloads/24h","Priority processing"]},
    {key:"gold",name:"Gold",price:"₹399/mo",features:["10 GB max file","50 downloads/24h","Priority processing"]},
    {key:"supreme",name:"Supreme",price:"₹699/mo",features:["Unlimited file size","Unlimited downloads","Bot access included","Highest priority"]}
  ];
  var html = '';
  tiers.forEach(function(t){
    var isCurrent = currentUser ? currentUser.tier === t.key : t.key === "guest";
    var color = TIER_COLORS[t.key] || "var(--muted)";
    html += '<div class="tier-card'+(isCurrent?' current':'')+'" style="border-color:'+(isCurrent?color:'var(--border)')+'">';
    html += '<div class="tname" style="color:'+color+'">'+t.name+'</div>';
    html += '<div class="tprice">'+t.price+'</div>';
    html += '<ul>';
    t.features.forEach(function(f){ html += '<li>'+f+'</li>'; });
    html += '</ul>';
    if(isCurrent) html += '<div style="margin-top:10px;font-size:12px;font-weight:700;color:'+color+'">YOUR CURRENT TIER</div>';
    html += '</div>';
  });
  document.getElementById("tierCards").innerHTML = html;
}

/* ---- Admin ---- */
function loadAdmin(){
  api("/api/admin/stats","GET").then(function(d){
    if(d && !d.error){
      var html = '';
      html += '<div class="stat-box"><div class="label">Total Users</div><div class="value">'+d.totalUsers+'</div></div>';
      html += '<div class="stat-box"><div class="label">Total Downloads</div><div class="value">'+d.totalDownloads+'</div></div>';
      html += '<div class="stat-box"><div class="label">Downloads (24h)</div><div class="value">'+d.todayDownloads+'</div></div>';
      html += '<div class="stat-box"><div class="label">Active Sessions</div><div class="value">'+d.activeSessions+'</div></div>';
      document.getElementById("adminStats").innerHTML = html;
    }
  }).catch(function(){});
  api("/api/admin/users","GET").then(function(d){
    if(!d || d.error){ document.getElementById("adminUserList").innerHTML = '<div class="empty">Failed to load users.</div>'; return; }
    if(!d.length){ document.getElementById("adminUserList").innerHTML = '<div class="empty">No users yet.</div>'; return; }
    var html = '<table><thead><tr><th>Username</th><th>Tier</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    d.forEach(function(u){
      var tier = u.tier || "free";
      var banned = u.banned || false;
      html += '<tr><td>'+escapeHtml(u.username)+'</td>';
      html += '<td><select class="tier-select" onchange="changeTier(\''+u.username+'\',this.value)">';
      Object.keys(TIER_LABELS).forEach(function(k){
        html += '<option value="'+k+'"'+(tier===k?' selected':'')+'>'+TIER_LABELS[k]+'</option>';
      });
      html += '</select></td>';
      html += '<td>'+(banned?'<span style="color:var(--danger)">Banned</span>':'<span style="color:var(--success)">Active</span>')+'</td>';
      html += '<td>'+(banned?'<button class="ban-btn unban" onclick="unbanUser(\''+u.username+'\')">Unban</button>':'<button class="ban-btn" onclick="banUser(\''+u.username+'\')">Ban</button>')+'</td></tr>';
    });
    html += '</tbody></table>';
    document.getElementById("adminUserList").innerHTML = html;
  }).catch(function(){});
  api("/api/admin/logs","GET").then(function(d){
    if(!d || d.error){ document.getElementById("adminLogList").innerHTML = '<div class="empty">No logs.</div>'; return; }
    if(!d.length){ document.getElementById("adminLogList").innerHTML = '<div class="empty">No activity yet.</div>'; return; }
    var html = '';
    d.forEach(function(l){
      var t = l.created_at ? new Date(l.created_at).toLocaleString("en-IN") : "";
      html += '<div class="row"><span><b>'+escapeHtml(l.event||"")+'</b>'+(l.ip?' (🇮🇳 '+escapeHtml(l.ip)+')':'')+'</span><span class="when">'+t+'</span></div>';
    });
    document.getElementById("adminLogList").innerHTML = html;
  }).catch(function(){});
}

function changeTier(username, tier){
  api("/api/admin/set-tier","POST",{username:username,tier:tier}).then(function(d){
    if(d.success){ toast("Tier changed for "+username,"success"); loadAdmin(); }
    else toast(d.error || "Failed","error");
  }).catch(function(){ toast("Network error","error"); });
}
function banUser(username){
  api("/api/admin/ban-user","POST",{username:username}).then(function(d){
    if(d.success){ toast("User banned: "+username,"success"); loadAdmin(); }
    else toast(d.error || "Failed","error");
  }).catch(function(){ toast("Network error","error"); });
}
function unbanUser(username){
  api("/api/admin/unban-user","POST",{username:username}).then(function(d){
    if(d.success){ toast("User unbanned: "+username,"success"); loadAdmin(); }
    else toast(d.error || "Failed","error");
  }).catch(function(){ toast("Network error","error"); });
}

function escapeHtml(s){
  if(!s) return "";
  var a = String.fromCharCode(38,97,109,112,59);  // &
  var b = String.fromCharCode(38,108,116,59);      // <
  var c = String.fromCharCode(38,103,116,59);      // >
  var d = String.fromCharCode(38,113,117,111,116,59); // "
  var e = String.fromCharCode(38,35,52,57,59);    // apostrophe entity
  return String(s).replace(/&/g,a).replace(/</g,b).replace(/>/g,c).replace(/"/g,d).replace(/'/g,e);
}

/* ---- Init ---- */
document.addEventListener("DOMContentLoaded", function(){
  /* Tab switching */
  document.querySelectorAll(".tab").forEach(function(t){
    t.addEventListener("click", function(){
      document.querySelectorAll(".tab").forEach(function(x){x.classList.remove("active");});
      t.classList.add("active");
      if(t.dataset.tab === "signin"){
        document.getElementById("signinForm").style.display = "block";
        document.getElementById("registerForm").style.display = "none";
      } else {
        document.getElementById("signinForm").style.display = "none";
        document.getElementById("registerForm").style.display = "block";
      }
    });
  });

  /* Admin toggle */
  document.getElementById("adminToggle").addEventListener("click", function(){
    var f = document.getElementById("adminLoginForm");
    f.style.display = f.style.display === "none" ? "block" : "none";
  });

  /* Modal close */
  document.getElementById("modalClose").addEventListener("click", closeLoginModal);
  document.getElementById("loginModal").addEventListener("click", function(e){
    if(e.target === this) closeLoginModal();
  });

  /* Donate modal close */
  document.getElementById("donateClose").addEventListener("click", function(){
    document.getElementById("donateModal").classList.remove("show");
    DONATION_DISMISSED = true;
  });
  document.getElementById("donateLater").addEventListener("click", function(){
    document.getElementById("donateModal").classList.remove("show");
  });
  document.getElementById("donateModal").addEventListener("click", function(e){
    if(e.target === this) this.classList.remove("show");
  });

  /* Sign in */
  document.getElementById("signinForm").addEventListener("submit", function(e){
    e.preventDefault();
    var u = document.getElementById("signinUser").value.trim();
    var p = document.getElementById("signinPass").value;
    document.getElementById("signinError").textContent = "";
    if(!u || !p){ document.getElementById("signinError").textContent = "Enter username and password"; return; }
    document.getElementById("signinBtn").disabled = true;
    document.getElementById("signinBtn").textContent = "Signing in…";
    api("/api/auth","POST",{action:"signin",username:u,password:p}).then(function(d){
      document.getElementById("signinBtn").disabled = false;
      document.getElementById("signinBtn").textContent = "Sign In";
      if(d.success){ toast("Welcome back, "+d.username+"!","success"); closeLoginModal(); tryAuth(); }
      else document.getElementById("signinError").textContent = d.error || "Login failed";
    }).catch(function(){
      document.getElementById("signinBtn").disabled = false;
      document.getElementById("signinBtn").textContent = "Sign In";
      document.getElementById("signinError").textContent = "Network error — server may be offline";
    });
  });

  /* Register */
  document.getElementById("registerForm").addEventListener("submit", function(e){
    e.preventDefault();
    var u = document.getElementById("regUser").value.trim();
    var p = document.getElementById("regPass").value;
    var p2 = document.getElementById("regPass2").value;
    document.getElementById("regError").textContent = "";
    if(!u || u.length < 3){ document.getElementById("regError").textContent = "Username must be 3+ chars"; return; }
    if(!p || p.length < 6){ document.getElementById("regError").textContent = "Password must be 6+ chars"; return; }
    if(p !== p2){ document.getElementById("regError").textContent = "Passwords don't match"; return; }
    document.getElementById("regBtn").disabled = true;
    document.getElementById("regBtn").textContent = "Creating…";
    api("/api/auth","POST",{action:"register",username:u,password:p}).then(function(d){
      document.getElementById("regBtn").disabled = false;
      document.getElementById("regBtn").textContent = "Create Account";
      if(d.success){ toast("Account created! Welcome "+d.username,"success"); closeLoginModal(); tryAuth(); }
      else document.getElementById("regError").textContent = d.error || "Registration failed";
    }).catch(function(){
      document.getElementById("regBtn").disabled = false;
      document.getElementById("regBtn").textContent = "Create Account";
      document.getElementById("regError").textContent = "Network error — server may be offline";
    });
  });

  /* Admin login */
  document.getElementById("adminLoginBtn").addEventListener("click", function(){
    var au = document.getElementById("adminUser").value.trim();
    var p = document.getElementById("adminPass").value;
    if(!au){ toast("Enter admin username","error"); return; }
    if(!p){ toast("Enter admin password","error"); return; }
    document.getElementById("adminLoginBtn").disabled = true;
    api("/api/auth","POST",{action:"admin_login",username:au,password:p}).then(function(d){
      document.getElementById("adminLoginBtn").disabled = false;
      if(d.success){ toast("Admin logged in","success"); closeLoginModal(); tryAuth(); }
      else toast(d.error || "Admin login failed","error");
    }).catch(function(){
      document.getElementById("adminLoginBtn").disabled = false;
      toast("Network error — server may be offline","error");
    });
  });

  /* Download button */
  document.getElementById("dlBtn").addEventListener("click", startDownload);
  document.getElementById("urlInput").addEventListener("keydown", function(e){
    if(e.key === "Enter") startDownload();
  });
  document.getElementById("urlInput").addEventListener("input", function(){
    var url = this.value.trim();
    if(url.length > 5){
      var platform = detectPlatform(url);
      var hint = document.getElementById("platformHint");
      hint.style.display = "flex";
      hint.innerHTML = '<span class="platform-tag">' + platform + '</span> detected';
    } else {
      document.getElementById("platformHint").style.display = "none";
    }
  });

  /* Nav buttons */
  document.querySelectorAll("[data-screen]").forEach(function(b){
    b.addEventListener("click", function(){ switchScreen(b.dataset.screen); });
  });

  /* Auth button & logout */
  document.getElementById("authBtn").addEventListener("click", openLoginModal);
  document.getElementById("guestSigninLink").addEventListener("click", openLoginModal);
  document.getElementById("logoutTopBtn").addEventListener("click", logout);
  document.getElementById("logoutBtn").addEventListener("click", logout);

  /* Init: load status, then try auth (non-blocking) */
  loadServerStatus();
  statusTimer = setInterval(loadServerStatus, 120000);
  onGuest(); /* Show downloader immediately as guest */
  tryAuth();  /* Try to auth in background, non-blocking */
});

window.changeTier = changeTier;
window.banUser = banUser;
window.unbanUser = unbanUser;
window.copyUPI = copyUPI;
window.pasteFromClipboard = pasteFromClipboard;
