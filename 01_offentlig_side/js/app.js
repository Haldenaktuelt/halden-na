import {
  db,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  COLLECTIONS
} from "../../00_firebase/firebase-db.js";

let appStarted = false;
let eventsSetupDone = false;
let activeFilter = "Forside";
let heroAutoTimer = null;
let heroPaused = false;

const HERO_INTERVAL_MS = 7000;

const merKategorier = [
  "Trafikk",
  "Sport",
  "Norge & Verden",
  "Kultur",
  "Meninger",
  "Historie",
  "Mest lest"
];

let saker = [];
let partners = [];
let currentHero = 0;
let currentList = [];
let heroList = [];

const cachedFirebaseSaker = JSON.parse(
  localStorage.getItem("hn_firebase_saker") || "[]"
);

const cachedFirebasePartnere = JSON.parse(
  localStorage.getItem("hn_firebase_partnere") || "[]"
);

if (cachedFirebaseSaker.length) {
  window.HALDEN_NA_SAKER = cachedFirebaseSaker.map(normalizeSak);
}

if (cachedFirebasePartnere.length) {
  window.HALDEN_NA_PARTNERE = cachedFirebasePartnere.map(normalizePartner);
}

const sakerQuery = query(
  collection(db, COLLECTIONS.saker),
  orderBy("oppdatertAt", "desc")
);

const partnereQuery = query(
  collection(db, COLLECTIONS.partnere),
  orderBy("oppdatertAt", "desc")
);

onSnapshot(sakerQuery, (snapshot) => {
  const firebaseSaker = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.status === "publisert") {
      firebaseSaker.push(normalizeSak({
        ...data,
        firebaseId: docSnap.id
      }));
    }
  });

  window.HALDEN_NA_SAKER = firebaseSaker;
  localStorage.setItem("hn_firebase_saker", JSON.stringify(firebaseSaker));

  if (!appStarted) {
    startApp();
  } else {
    renderDynamicContent();
  }
});

onSnapshot(partnereQuery, (snapshot) => {
  const firebasePartnere = [];

  snapshot.forEach((docSnap) => {
    firebasePartnere.push(normalizePartner({
      ...docSnap.data(),
      firebaseId: docSnap.id
    }));
  });

  partners = firebasePartnere;
  window.HALDEN_NA_PARTNERE = firebasePartnere;
  localStorage.setItem("hn_firebase_partnere", JSON.stringify(firebasePartnere));

  if (appStarted) {
    renderDynamicContent();
  }
});

function normalizeSak(sak = {}) {
  const bildeUrl = sak.bildeUrl || sak.bilde || "";
  const videoUrl = sak.videoUrl || sak.video || "";
  const mediaPlassering = sak.mediaPlassering || sak.mediaPlacement || "top";

  return {
    ...sak,
    kategori: sak.kategori || "Lokalt",
    tittel: sak.tittel || "Uten tittel",
    ingress: sak.ingress || "",
    tekst: sak.tekst || "",
    bildeUrl,
    videoUrl,
    mediaPlassering,
    kilde: sak.kilde || sak.sourceType || "",
    dato: sak.dato || "",
    tid: sak.tid || "",
    status: sak.status || "",
    hovedsak: sak.hovedsak === true,

    bilde: bildeUrl,
    video: videoUrl,
    mediaPlacement: mediaPlassering
  };
}

function normalizePartner(p = {}) {
  return {
    ...p,
    navn: p.navn || p.name || "Lokal partner",
    logoTekst: p.logoTekst || p.logoText || "HN",
    logoUrl: p.logoUrl || "",
    tekst: p.tekst || p.text || "",
    url: p.url || "",
    niva: p.niva || p.level || "partner",
    size: p.size || "small",
    start: p.start || "",
    slutt: p.slutt || p.end || "",
    aktiv: p.aktiv !== false
  };
}

function escapeText(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function formatDato(value) {
  if (!value) return "";

  const d = new Date(value);
  if (isNaN(d.getTime())) return "";

  return d.toLocaleString("no-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function hentHero(i) {
  return heroList[i];
}

function startApp() {
  appStarted = true;

  saker = (window.HALDEN_NA_SAKER || []).map(normalizeSak);
  partners = (window.HALDEN_NA_PARTNERE || []).map(normalizePartner);
  currentList = lagListeForFilter(activeFilter);
  heroList = lagHeroListe();

  setupStaticEvents();
  renderDynamicContent();
  startHeroAutoRotate();
}

function sorterForside(list) {
  const hoved = list.filter(s => s.hovedsak === true);
  const vanlig = list.filter(s => s.hovedsak !== true);
  return [...hoved, ...vanlig];
}

function lagHeroListe() {
  return saker.filter(s => s.hovedsak === true).slice(0, 3);
}

function lagListeForFilter(filter) {
  const publiserte = saker.filter(s => s.status === "publisert" || !s.status);

  if (filter === "Forside" || filter === "Alle") {
    return sorterForside(publiserte);
  }

  if (filter === "Mest lest") {
    return sorterForside(publiserte);
  }

  return publiserte.filter(s => s.kategori === filter);
}

function renderDynamicContent() {
  saker = (window.HALDEN_NA_SAKER || []).map(normalizeSak);
  partners = (window.HALDEN_NA_PARTNERE || []).map(normalizePartner);

  currentList = lagListeForFilter(activeFilter);
  heroList = lagHeroListe();

  const statusCount = document.getElementById("status-count");
  const frontHero = document.getElementById("frontHero");

  if (statusCount) {
    statusCount.textContent = `${saker.length} saker i dag`;
  }

  if (frontHero) {
    frontHero.style.display = activeFilter === "Forside" && heroList.length ? "" : "none";
  }

  fyllHeroer();
  byggMestLest();
  byggKort();
  dots();
}

function vekt(n) {
  if (n === "hovedpartner") return 6;
  if (n === "partner") return 3;
  return 1;
}

function aktivePartnere() {
  const today = new Date().toISOString().slice(0, 10);

  return partners.filter(p =>
    p.aktiv !== false &&
    (!p.start || p.start <= today) &&
    (!p.slutt || p.slutt >= today)
  );
}

function velgPartner() {
  const list = aktivePartnere();
  if (!list.length) return null;

  const weighted = [];

  list.forEach(p => {
    const count = vekt(p.niva);

    for (let i = 0; i < count; i++) {
      weighted.push(p);
    }
  });

  return weighted[Math.floor(Math.random() * weighted.length)];
}

function fyllHero(n, i) {
  const sak = hentHero(i);
  const hero = document.getElementById(`hero${n}`);

  if (!hero) return;

  if (!sak || activeFilter !== "Forside") {
    hero.style.display = "none";
    return;
  }

  hero.style.display = "";
  hero.style.backgroundImage = sak.bildeUrl ? `url('${sak.bildeUrl}')` : "";
  hero.dataset.sakIndex = String(i);

  const k = document.getElementById(`hero${n}-kicker`);
  const t = document.getElementById(`hero${n}-title`);
  const l = document.getElementById(`hero${n}-lead`);

  if (k) k.textContent = `${sak.kategori} · Hovedsak`;
  if (t) t.textContent = sak.tittel;
  if (l) l.textContent = sak.ingress;
}

function fyllHeroer() {
  fyllHero(1, 0);
  fyllHero(2, 1);
  fyllHero(3, 2);
}

function renderMedia(sak) {
  const top = document.getElementById("modal-media-top");
  const bottom = document.getElementById("modal-media-bottom");

  if (!top || !bottom) return;

  top.innerHTML = "";
  bottom.innerHTML = "";
  top.classList.remove("show");
  bottom.classList.remove("show");

  const media = sak.videoUrl
    ? `<video src="${escapeText(sak.videoUrl)}" controls playsinline></video>`
    : sak.bildeUrl
      ? `<img src="${escapeText(sak.bildeUrl)}" alt="">`
      : "";

  if (!media) return;

  const target = sak.mediaPlassering === "bottom" ? bottom : top;
  target.innerHTML = media;
  target.classList.add("show");
}

function renderMeta(sak) {
  const meta = document.getElementById("modal-meta");
  if (!meta) return;

  const parts = [];

  const dato = formatDato(sak.dato);
  if (dato) parts.push(`Publisert: ${dato}`);
  if (sak.kilde) parts.push(`Kilde: ${sak.kilde}`);

  meta.textContent = parts.join(" · ");
  meta.style.display = parts.length ? "block" : "none";
}

function renderPartner() {
  const box = document.getElementById("partner-ad");
  if (!box) return;

  const p = velgPartner();

  if (!p) {
    box.style.display = "none";
    return;
  }

  box.style.display = "block";

  const isLarge = p.size === "large" || p.size === "both";
  box.classList.toggle("large", isLarge);

  const labelMap = {
    hovedpartner: "Hovedpartner",
    partner: "Partner",
    stottespiller: "Støttespiller"
  };

  document.getElementById("partner-label").textContent = labelMap[p.niva] || "Partner";
  document.getElementById("partner-logo").innerHTML = p.logoUrl
    ? `<img src="${escapeText(p.logoUrl)}" alt="${escapeText(p.navn)}">`
    : escapeText(p.logoTekst || "HN");

  document.getElementById("partner-title").textContent = p.navn || "Lokal partner";
  document.getElementById("partner-text").textContent = p.tekst || "";

  const url = document.getElementById("partner-url");

  if (p.url && isLarge) {
    url.href = p.url;
    url.style.display = "inline-flex";
  } else {
    url.style.display = "none";
  }
}

function skjulPartner() {
  const box = document.getElementById("partner-ad");
  if (box) box.style.display = "none";
}

function åpneSak(sak) {
  const modal = document.getElementById("modal");
  const modalText = document.getElementById("modal-text");
  const fullSak = normalizeSak(sak);

  if (!fullSak || !modal || !modalText) return;

  heroPaused = true;

  document.getElementById("modal-kicker").textContent = fullSak.kategori || "Lokalt";
  document.getElementById("modal-title").textContent = fullSak.tittel || "Uten tittel";
  modalText.textContent = fullSak.tekst || fullSak.ingress || "";

  renderMedia(fullSak);
  renderMeta(fullSak);
  renderPartner();

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function åpneTipsSkjema() {
  const modal = document.getElementById("modal");
  const modalText = document.getElementById("modal-text");
  const top = document.getElementById("modal-media-top");
  const bottom = document.getElementById("modal-media-bottom");
  const meta = document.getElementById("modal-meta");

  if (!modal || !modalText) return;

  heroPaused = true;

  if (top) {
    top.innerHTML = "";
    top.classList.remove("show");
  }

  if (bottom) {
    bottom.innerHTML = "";
    bottom.classList.remove("show");
  }

  if (meta) {
    meta.textContent = "";
    meta.style.display = "none";
  }

  skjulPartner();

  document.getElementById("modal-kicker").textContent = "Tips oss";
  document.getElementById("modal-title").textContent = "Send tips til Halden Nå";

  modalText.innerHTML = `
    <form id="tips-form" class="tipsForm">
      <label>Hva gjelder tipset?</label>
      <input id="tips-title" type="text" placeholder="Kort tittel">

      <label>Sted</label>
      <input id="tips-place" type="text" placeholder="F.eks. Halden sentrum">

      <label>Tips</label>
      <textarea id="tips-text" placeholder="Skriv kort hva som har skjedd eller hva vi bør se på..."></textarea>

      <label>Bilde-URL</label>
      <input id="tips-image" type="url" placeholder="https://...">

      <label>Navn</label>
      <input id="tips-name" type="text" placeholder="Valgfritt">

      <label>Kontaktinfo</label>
      <input id="tips-contact" type="text" placeholder="Telefon eller e-post, valgfritt">

      <button id="tips-submit" class="read" type="submit">Send tips</button>
      <div id="tips-message" class="articleMeta"></div>
    </form>
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  const form = document.getElementById("tips-form");
  const message = document.getElementById("tips-message");
  const submit = document.getElementById("tips-submit");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = document.getElementById("tips-title")?.value.trim() || "";
    const place = document.getElementById("tips-place")?.value.trim() || "";
    const text = document.getElementById("tips-text")?.value.trim() || "";
    const image = document.getElementById("tips-image")?.value.trim() || "";
    const name = document.getElementById("tips-name")?.value.trim() || "";
    const contact = document.getElementById("tips-contact")?.value.trim() || "";

    if (!title && !text) {
      if (message) message.textContent = "Skriv minst tittel eller tips før du sender.";
      return;
    }

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Sender...";
    }

    try {
      await addDoc(collection(db, COLLECTIONS.tips), {
        title,
        place,
        text,
        image,
        name,
        contact,
        status: "nytt",
        createdAt: serverTimestamp()
      });

      form.innerHTML = `
        <div class="kicker">Tips mottatt</div>
        <h2>Takk for tipset!</h2>
        <p>Tipset er sendt inn til redaksjonen.</p>
      `;
    } catch (err) {
      console.error("Kunne ikke sende tips:", err);

      if (message) {
        message.textContent = "Noe gikk galt. Prøv igjen senere.";
      }

      if (submit) {
        submit.disabled = false;
        submit.textContent = "Send tips";
      }
    }
  });
}

function lukkSak() {
  const modal = document.getElementById("modal");
  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  heroPaused = false;
}

function byggMestLest() {
  const el = document.getElementById("mest-lest-liste");
  if (!el) return;

  el.innerHTML = "";

  sorterForside(saker).slice(0, 4).forEach(sak => {
    const item = document.createElement("div");
    item.className = "item";

    item.innerHTML = `
      <small>${escapeText(sak.tid || "Nå")} · ${escapeText(sak.kategori || "Lokalt")}</small>
      <h3>${escapeText(sak.tittel || "Uten tittel")}</h3>
      <p>${escapeText(sak.ingress || "")}</p>
    `;

    item.addEventListener("click", () => åpneSak(sak));
    el.appendChild(item);
  });
}

function byggKort() {
  const el = document.getElementById("seksjonskort");
  if (!el) return;

  el.innerHTML = "";

  currentList.slice(0, 12).forEach((sak, i) => {
    const kort = document.createElement("article");
    kort.className = i === 1 ? "card dark" : "card";

    const image = sak.bildeUrl
      ? `<div class="cardImage" style="background-image:url('${escapeText(sak.bildeUrl)}')"></div>`
      : "";

    kort.innerHTML = `
      ${image}
      <div class="cardBody">
        <div class="kicker">${escapeText(sak.kategori || "Lokalt")}</div>
        <h3>${escapeText(sak.tittel || "Uten tittel")}</h3>
        <p>${escapeText(sak.ingress || "")}</p>
      </div>
    `;

    kort.addEventListener("click", () => åpneSak(sak));
    el.appendChild(kort);
  });
}

function dots() {
  [1, 2, 3].forEach((n, i) => {
    const d = document.getElementById(`dot${n}`);
    if (d) d.classList.toggle("on", i === currentHero);
  });
}

function visibleHeroCount() {
  return Math.min(3, heroList.length);
}

function slide(dir) {
  const slider = document.getElementById("hero-slider");
  const ids = ["hero1", "hero2", "hero3"];
  const count = visibleHeroCount();

  if (!count) return;

  currentHero = (currentHero + dir + count) % count;

  const target = document.getElementById(ids[currentHero]);

  if (target && slider) {
    slider.scrollTo({
      left: target.offsetLeft - slider.offsetLeft,
      behavior: "smooth"
    });
  }

  dots();
}

function startHeroAutoRotate() {
  stopHeroAutoRotate();

  heroAutoTimer = setInterval(() => {
    if (heroPaused) return;
    if (activeFilter !== "Forside") return;
    if (visibleHeroCount() < 2) return;

    slide(1);
  }, HERO_INTERVAL_MS);
}

function stopHeroAutoRotate() {
  if (heroAutoTimer) {
    clearInterval(heroAutoTimer);
    heroAutoTimer = null;
  }
}

function settFilter(filter) {
  activeFilter = filter;
  currentList = lagListeForFilter(filter);
  heroList = lagHeroListe();
  currentHero = 0;

  renderDynamicContent();

  document.querySelectorAll("[data-filter]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
    btn.classList.toggle("on", btn.dataset.filter === filter);
  });

  const moreBtn = document.getElementById("more-btn");
  if (moreBtn) {
    moreBtn.classList.toggle("active", merKategorier.includes(filter));
  }

  const moreMenu = document.getElementById("more-menu");
  if (moreMenu) {
    moreMenu.classList.remove("open");
  }
}

function toggleMerMeny(e) {
  e.stopPropagation();

  const moreMenu = document.getElementById("more-menu");
  if (!moreMenu) return;

  moreMenu.classList.toggle("open");
}

function setupHeroClicks() {
  ["hero1", "hero2", "hero3"].forEach((id, index) => {
    const hero = document.getElementById(id);
    if (!hero) return;

    hero.addEventListener("mouseenter", () => {
      heroPaused = true;
    });

    hero.addEventListener("mouseleave", () => {
      heroPaused = false;
    });

    hero.addEventListener("touchstart", () => {
      heroPaused = true;
      setTimeout(() => {
        heroPaused = false;
      }, 9000);
    }, { passive: true });

    hero.addEventListener("click", () => {
      åpneSak(hentHero(index));
    });
  });
}

function setupStaticEvents() {
  if (eventsSetupDone) return;
  eventsSetupDone = true;

  const closeModal = document.getElementById("close-modal");
  const modal = document.getElementById("modal");

  if (closeModal) {
    closeModal.addEventListener("click", lukkSak);
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) lukkSak();
    });
  }

  document.addEventListener("click", () => {
    const moreMenu = document.getElementById("more-menu");
    if (moreMenu) moreMenu.classList.remove("open");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      lukkSak();
      const moreMenu = document.getElementById("more-menu");
      if (moreMenu) moreMenu.classList.remove("open");
    }
  });

  document.getElementById("prev-hero")?.addEventListener("click", (e) => {
    e.stopPropagation();
    heroPaused = true;
    slide(-1);
    setTimeout(() => {
      heroPaused = false;
    }, 9000);
  });

  document.getElementById("next-hero")?.addEventListener("click", (e) => {
    e.stopPropagation();
    heroPaused = true;
    slide(1);
    setTimeout(() => {
      heroPaused = false;
    }, 9000);
  });

  document.getElementById("hero-slider")?.addEventListener("scroll", () => {
    const slider = document.getElementById("hero-slider");
    const slides = [...document.querySelectorAll(".hero")].filter(sl => sl.style.display !== "none");

    let closest = 0;
    let dist = Infinity;

    slides.forEach((sl, i) => {
      const d = Math.abs(
        slider.scrollLeft -
        (sl.offsetLeft - slider.offsetLeft)
      );

      if (d < dist) {
        dist = d;
        closest = i;
      }
    });

    currentHero = closest;
    dots();
  }, { passive: true });

  document.querySelectorAll("[data-filter]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      settFilter(btn.dataset.filter);
    });
  });

  document.getElementById("tips-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    åpneTipsSkjema();
  });

  document.getElementById("more-btn")?.addEventListener("click", toggleMerMeny);

  document.getElementById("more-menu")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  setupHeroClicks();
}

document.addEventListener("DOMContentLoaded", () => {
  if (!appStarted) {
    startApp();
  }
});


/* LIVEKORT V4 – Politilogg, værikon, dynamisk trafikk og VM */

const LIVE_API_BASE = location.hostname === "127.0.0.1" || location.hostname === "localhost"
  ? "http://localhost:8888/.netlify/functions"
  : "/.netlify/functions";

const WORLD_CUP_START = new Date("2026-06-11T20:00:00+02:00");

function liveUrl(name) {
  return `${LIVE_API_BASE}/${name}`;
}

async function hentLiveJson(name) {
  const res = await fetch(liveUrl(name), { cache: "no-store" });
  if (!res.ok) throw new Error(`${name} svarte ${res.status}`);
  return await res.json();
}

function symbolToText(symbol = "") {
  if (!symbol) return "Værdata hentet";
  if (symbol.includes("clearsky")) return "Klart";
  if (symbol.includes("fair")) return "Lettskyet";
  if (symbol.includes("partlycloudy")) return "Delvis skyet";
  if (symbol.includes("cloudy")) return "Skyet";
  if (symbol.includes("rain")) return "Regn";
  if (symbol.includes("sleet")) return "Sludd";
  if (symbol.includes("snow")) return "Snø";
  if (symbol.includes("fog")) return "Tåke";
  return symbol.replaceAll("_", " ");
}

function formatOsloTime(value = "") {
  if (!value) return "--:--";

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--:--";

  return d.toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo"
  });
}

function todayOsloDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function hentVaerDirekteFraMet() {
  const lat = "59.1248";
  const lon = "11.3875";

  const forecastRes = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
    { cache: "no-store" }
  );

  if (!forecastRes.ok) throw new Error(`MET vær svarte ${forecastRes.status}`);

  const forecast = await forecastRes.json();
  const first = forecast?.properties?.timeseries?.[0];
  const details = first?.data?.instant?.details || {};
  const next =
    first?.data?.next_1_hours ||
    first?.data?.next_6_hours ||
    first?.data?.next_12_hours ||
    {};

  let sun = { sunrise: "--:--", sunset: "--:--" };

  try {
    const sunRes = await fetch(
      `https://api.met.no/weatherapi/sunrise/3.0/sun?lat=${lat}&lon=${lon}&date=${todayOsloDate()}&offset=%2B02:00`,
      { cache: "no-store" }
    );

    if (sunRes.ok) {
      const sunData = await sunRes.json();
      sun = {
        sunrise: formatOsloTime(sunData?.properties?.sunrise?.time),
        sunset: formatOsloTime(sunData?.properties?.sunset?.time)
      };
    }
  } catch (err) {
    console.log("Soldata direkte feilet:", err);
  }

  return {
    ok: true,
    updatedAt: forecast?.properties?.meta?.updated_at || new Date().toISOString(),
    temperature: Math.round(details.air_temperature),
    feelsLike: Math.round(details.air_temperature_apparent ?? details.air_temperature),
    wind: Math.round(details.wind_speed ?? 0),
    rain: Number(next?.details?.precipitation_amount ?? 0),
    description: symbolToText(next?.summary?.symbol_code || ""),
    symbol: next?.summary?.symbol_code || "",
    ...sun
  };
}

function renderPolitilogg(items = []) {
  const feed = document.getElementById("politilogg-feed");
  if (!feed) return;

  const safeItems = items.length ? items : [
    { time: "NÅ", place: "ØST", text: "Ingen nye hendelser vist akkurat nå." },
    { time: "INFO", place: "HALDEN", text: "Trykk for å åpne hele politiloggen." }
  ];

  feed.innerHTML = "";

  safeItems.slice(0, 3).forEach(item => {
    const row = document.createElement("div");
    row.className = "liveItem";
    row.innerHTML = `
      <small>${escapeText(item.time || "NÅ")} · ${escapeText(item.place || "ØST")}</small>
      <p>${escapeText(item.text || "Ny melding fra politiet.")}</p>
    `;
    feed.appendChild(row);
  });
}

async function hentPolitilogg() {
  try {
    const data = await hentLiveJson("politilogg");
    renderPolitilogg(data.items || []);
  } catch (err) {
    console.log("Politilogg via function feilet:", err);
    renderPolitilogg([
      { time: "NÅ", place: "ØST", text: "Trykk for å åpne politiets egen logg." },
      { time: "INFO", place: "HALDEN", text: "Ekte logg krever Netlify Dev eller publisert Netlify-side." }
    ]);
  }
}

function weatherIcon(symbol = "", description = "") {
  const value = `${symbol} ${description}`.toLowerCase();
  if (value.includes("thunder")) return "⛈️";
  if (value.includes("snow") || value.includes("snø")) return "🌨️";
  if (value.includes("sleet") || value.includes("sludd")) return "🌨️";
  if (value.includes("rain") || value.includes("regn")) return "🌧️";
  if (value.includes("fog") || value.includes("tåke")) return "🌫️";
  if (value.includes("clearsky") || value.includes("klart")) return "☀️";
  if (value.includes("fair") || value.includes("lettskyet")) return "🌤️";
  if (value.includes("partlycloudy") || value.includes("delvis")) return "⛅";
  if (value.includes("cloudy") || value.includes("skyet")) return "☁️";
  return "🌤️";
}

function renderWeather(data = {}) {
  const tempEl = document.getElementById("weather-temp");
  const windEl = document.getElementById("weather-wind");
  const rainEl = document.getElementById("weather-rain");
  const iconEl = document.getElementById("weather-icon");
  const feelsEl = document.getElementById("weather-feels");
  const sunriseEl = document.getElementById("weather-sunrise");
  const sunsetEl = document.getElementById("weather-sunset");

  if (tempEl && data.temperature !== undefined) {
    tempEl.textContent = `${data.temperature}°`;
  }

  if (windEl && data.wind !== undefined) {
    windEl.textContent = data.wind;
  }

  if (rainEl && data.rain !== undefined) {
    rainEl.textContent = data.rain;
  }

  if (iconEl) {
    iconEl.textContent = weatherIcon(data.symbol, data.description);
  }

  if (feelsEl && data.feelsLike !== undefined) {
    feelsEl.textContent = `${data.feelsLike}°`;
  }

  if (sunriseEl && data.sunrise) {
    sunriseEl.textContent = data.sunrise;
  }

  if (sunsetEl && data.sunset) {
    sunsetEl.textContent = data.sunset;
  }
}

async function hentVær() {
  try {
    const data = await hentLiveJson("weather");
    renderWeather(data);
    return;
  } catch (err) {
    console.log("Vær via Netlify Function feilet, prøver direkte MET:", err);
  }

  try {
    const data = await hentVaerDirekteFraMet();
    renderWeather(data);
    return;
  } catch (err) {
    console.log("Direkte MET feilet:", err);
  }

  renderWeather({
    temperature: "--",
    feelsLike: "--",
    wind: "--",
    rain: "--",
    sunrise: "--:--",
    sunset: "--:--",
    description: "Trykk for Yr",
    symbol: "fair"
  });
}

function renderTraffic(items = [], active = false) {
  const feed = document.getElementById("traffic-feed");
  const card = document.getElementById("traffic-card");
  const row = document.getElementById("liveRow");
  if (!feed || !card || !row) return;

  const shouldShow = active === true && items.length > 0;

  row.classList.toggle("hasTraffic", shouldShow);
  card.classList.toggle("trafficHidden", !shouldShow);

  if (!shouldShow) return;

  feed.innerHTML = "";
  items.slice(0, 3).forEach(item => {
    const text = typeof item === "string" ? item : item.text || item.title || "Trafikkmelding";
    const line = document.createElement("div");
    line.className = "liveItem compact";
    line.innerHTML = `<p>• ${escapeText(text)}</p>`;
    feed.appendChild(line);
  });
}

async function hentTrafikk() {
  try {
    const data = await hentLiveJson("traffic");
    renderTraffic(data.items || [], data.active === true);
  } catch (err) {
    console.log("Trafikk via function feilet:", err);
    renderTraffic([], false);
  }
}

function updateWorldCupCountdown() {
  const daysEl = document.getElementById("worldcup-days");
  const startEl = document.getElementById("worldcup-start");
  if (!daysEl || !startEl) return;

  const diff = WORLD_CUP_START.getTime() - new Date().getTime();

  if (diff <= 0) {
    daysEl.textContent = "NÅ";
    startEl.textContent = "VM er i gang";
    return;
  }

  daysEl.textContent = Math.ceil(diff / (1000 * 60 * 60 * 24));
  startEl.textContent = "Starter 11. juni 2026";
}

function renderSport(items = []) {
  const feed = document.getElementById("sport-feed");
  if (!feed) return;

  const safeItems = items.length ? items : [
    "Halden NÅ følger VM 2026",
    "Åpningskamp: 11. juni",
    "Trykk for FIFA sin VM-side"
  ];

  feed.innerHTML = "";

  safeItems.slice(0, 2).forEach(item => {
    const text = typeof item === "string" ? item : item.text || item.title || "Sport";
    const row = document.createElement("div");
    row.className = "liveItem compact";
    row.innerHTML = `<p>• ${escapeText(text)}</p>`;
    feed.appendChild(row);
  });
}

async function hentSport() {
  updateWorldCupCountdown();

  try {
    const data = await hentLiveJson("sport");
    renderSport(data.items || []);
  } catch (err) {
    console.log("Sport via function feilet:", err);
    renderSport();
  }
}

function startLivekort() {
  hentPolitilogg();
  hentVær();
  hentTrafikk();
  hentSport();

  setInterval(hentPolitilogg, 120000);
  setInterval(hentVær, 600000);
  setInterval(hentTrafikk, 300000);
  setInterval(hentSport, 900000);
  setInterval(updateWorldCupCountdown, 60000);
}

document.addEventListener("DOMContentLoaded", startLivekort);
