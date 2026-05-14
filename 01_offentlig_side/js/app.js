import {
  db,
  collection,
  query,
  orderBy,
  onSnapshot,
  COLLECTIONS
} from "../../00_firebase/firebase-db.js";

let firebaseLoaded = false;
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

const sakerQuery = query(
  collection(db, COLLECTIONS.saker),
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

  console.log("Live saker fra Firebase:", firebaseSaker);

  if (!firebaseLoaded) {
    firebaseLoaded = true;
    startApp();
  } else {
    renderDynamicContent();
  }
});

const cachedFirebaseSaker = JSON.parse(
  localStorage.getItem("hn_firebase_saker") || "[]"
);

if (cachedFirebaseSaker.length) {
  window.HALDEN_NA_SAKER = cachedFirebaseSaker.map(normalizeSak);
}

let saker = [];
let partners = [];
let currentHero = 0;
let currentList = [];

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
    hovedsak: sak.hovedsak === true,

    bilde: bildeUrl,
    video: videoUrl,
    mediaPlacement: mediaPlassering
  };
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

function hentSak(i) {
  return currentList[i] || saker[i] || saker[0];
}

function startApp() {
  saker = (window.HALDEN_NA_SAKER || []).map(normalizeSak);
  partners = window.HALDEN_NA_PARTNERE || [];
  currentList = lagListeForFilter(activeFilter);

  setupStaticEvents();
  renderDynamicContent();
  startHeroAutoRotate();
}

function sorterForside(list) {
  const hoved = list.filter(s => s.hovedsak === true).slice(0, 3);
  const vanlig = list.filter(s => s.hovedsak !== true);
  return [...hoved, ...vanlig];
}

function lagListeForFilter(filter) {
  if (filter === "Forside" || filter === "Alle") {
    return sorterForside(saker);
  }

  if (filter === "Mest lest") {
    return sorterForside(saker);
  }

  return saker.filter(s => s.kategori === filter);
}

function renderDynamicContent() {
  saker = (window.HALDEN_NA_SAKER || []).map(normalizeSak);
  currentList = lagListeForFilter(activeFilter);

  const statusCount = document.getElementById("status-count");
  const frontHero = document.getElementById("frontHero");

  if (statusCount) {
    statusCount.textContent = `${saker.length} saker i dag`;
  }

  if (frontHero) {
    frontHero.style.display = activeFilter === "Forside" ? "" : "none";
  }

  fyllHeroer();
  byggMestLest();
  byggKort();
  dots();
}

function vekt(n) {
  return n === "hovedpartner" ? 6 : n === "partner" ? 3 : 1;
}

function aktiv(size = "small") {
  const today = new Date().toISOString().slice(0, 10);

  return partners.filter(p =>
    (p.aktiv !== false) &&
    (!p.start || p.start <= today) &&
    (!p.slutt || p.slutt >= today) &&
    (!p.size || p.size === size || p.size === "both")
  );
}

function velgPartner(size = "small") {
  const list = aktiv(size);
  if (!list.length) return null;

  const weighted = [];

  list.forEach(p => {
    for (let i = 0; i < vekt(p.niva); i++) {
      weighted.push(p);
    }
  });

  return weighted[Math.floor(Math.random() * weighted.length)];
}

function fyllHero(n, i) {
  const sak = hentSak(i);
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

  if (k) k.textContent = sak.hovedsak ? `${sak.kategori} · Hovedsak` : sak.kategori;
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
    ? `<video src="${sak.videoUrl}" controls playsinline></video>`
    : sak.bildeUrl
      ? `<img src="${sak.bildeUrl}" alt="">`
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

  const p = velgPartner("large") || velgPartner("small");

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
    ? `<img src="${p.logoUrl}" alt="${p.navn}">`
    : (p.logoTekst || "HN");

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

function åpneSak(sak) {
  const modal = document.getElementById("modal");
  const fullSak = normalizeSak(sak);

  if (!fullSak || !modal) return;

  heroPaused = true;

  document.getElementById("modal-kicker").textContent = fullSak.kategori || "Lokalt";
  document.getElementById("modal-title").textContent = fullSak.tittel || "Uten tittel";
  document.getElementById("modal-text").textContent = fullSak.tekst || fullSak.ingress || "";

  renderMedia(fullSak);
  renderMeta(fullSak);
  renderPartner();

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
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
      <small>${sak.tid || "Nå"} · ${sak.kategori || "Lokalt"}</small>
      <h3>${sak.tittel || "Uten tittel"}</h3>
      <p>${sak.ingress || ""}</p>
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
      ? `<div class="cardImage" style="background-image:url('${sak.bildeUrl}')"></div>`
      : "";

    kort.innerHTML = `
      ${image}
      <div class="cardBody">
        <div class="kicker">${sak.kategori || "Lokalt"}</div>
        <h3>${sak.tittel || "Uten tittel"}</h3>
        <p>${sak.ingress || ""}</p>
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
  return Math.min(3, currentList.length);
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
      åpneSak(hentSak(index));
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
    const slides = [...document.querySelectorAll(".hero")];

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
    åpneSak({
      kategori: "Tips oss",
      tittel: "Send tips til Halden Nå",
      tekst: "Her kommer tipsflyten.\n\nForeløpig kan du sende inn: bilde, sted, kort tekst og kontaktinfo.",
      dato: new Date().toISOString()
    });
  });

  document.getElementById("more-btn")?.addEventListener("click", toggleMerMeny);

  document.getElementById("more-menu")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  setupHeroClicks();
}

document.addEventListener("DOMContentLoaded", startApp);