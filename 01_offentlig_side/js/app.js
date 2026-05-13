document.addEventListener("DOMContentLoaded", () => {

  const saker = window.HALDEN_NA_SAKER;

  if (!saker || saker.length === 0) {
    console.error("Ingen saker funnet.");
    return;
  }

  function fyllHero(heroNummer, sakIndex) {
    const sak = saker[sakIndex];
    if (!sak) return;

    document.getElementById(`hero${heroNummer}-kicker`).textContent = sak.kategori;
    document.getElementById(`hero${heroNummer}-title`).textContent = sak.tittel;
    document.getElementById(`hero${heroNummer}-lead`).textContent = sak.ingress;

    document.getElementById(`hero${heroNummer}`).style.backgroundImage =
      `url('${sak.bilde}')`;
  }

  fyllHero(1, 0);
  fyllHero(2, 1);
  fyllHero(3, 2);

function åpneSak(sak) {
  if (!sak) return;

  document.getElementById("modal-kicker").textContent = sak.kategori;
  document.getElementById("modal-title").textContent = sak.tittel;
  document.getElementById("modal-text").textContent = sak.tekst;

  document.getElementById("modal").style.display = "flex";
  document.body.classList.add("modal-open");
}

  document.querySelectorAll("[data-sak-index]").forEach(hero => {
    hero.addEventListener("click", (e) => {
      e.preventDefault();
      const sakIndex = Number(hero.dataset.sakIndex);
      åpneSak(saker[sakIndex]);
    });
  });

const closeModal = document.getElementById("close-modal");

if (closeModal) {
  closeModal.addEventListener("click", (e) => {
    e.preventDefault();

    document.getElementById("modal").style.display = "none";
    document.body.classList.remove("modal-open");
  });
}

  const mestLestListe = document.getElementById("mest-lest-liste");

  if (mestLestListe) {
    mestLestListe.innerHTML = "";

    saker.slice(0, 3).forEach((sak) => {
      const item = document.createElement("div");
      item.className = "item";

      item.innerHTML = `
        <small>${sak.tid} · ${sak.kategori}</small>
        <h3>${sak.tittel}</h3>
        <p>${sak.ingress}</p>
      `;

      item.addEventListener("click", () => åpneSak(sak));
      mestLestListe.appendChild(item);
    });
  }

  const seksjonskort = document.getElementById("seksjonskort");

  if (seksjonskort) {
    seksjonskort.innerHTML = "";

    saker.slice(0, 3).forEach((sak, index) => {
      const kort = document.createElement("article");
      kort.className = index === 1 ? "card dark" : "card";

      kort.innerHTML = `
        <div class="kicker">${sak.kategori}</div>
        <h3>${sak.tittel}</h3>
        <p>${sak.ingress}</p>
      `;

      kort.addEventListener("click", () => åpneSak(sak));
      seksjonskort.appendChild(kort);
    });
  }

});