# Micro portfolio

Dvě malé stránky (`p1`, `p2`) se seznamem „portfolia“ a **živými cenami v Kč**. Na každou vede QR kód z tištěné kartičky, na které je i pětimístné heslo.
Web nemá žádný build, jsou to čisté HTML/CSS/JS soubory.

| Stránka | Adresa |
| --- | --- |
| `p1` | `https://zakutana.github.io/micro-portfolio/p1/?n=<jméno>` |
| `p2` | `https://zakutana.github.io/micro-portfolio/p2/?n=<jméno>` |

Jméno se na stránku dostane jen z odkazu v QR kódu (`n=`), v repu není nikde. Hesla a jména jsou v `private/` (git-ignorováno).

## Nasazení (GitHub Pages)

1. Mergnout pracovní větev do `main` (nebo v kroku 2 vybrat přímo ji).
2. GitHub → **Settings → Pages → Build and deployment**: *Deploy from a branch*, větev `main`, složka `/ (root)`. (Pokud je výchozí větev repa jiná, v Settings → Branches ji přepni na `main`.)
3. Za minutu je web na adrese výše. (Pages zdarma vyžadují veřejné repo.)

## Změna portfolia

Před nasazením změny v `assets/` spusť `node tools/bump-version.mjs` (nová verze souborů, ať si telefon nespojí staré soubory z mezipaměti s novými). Změna jen v `config.json` to nepotřebuje.

Otevři `p1/config.json` (nebo `p2/config.json`), uprav seznam `holdings`, commit a push. Seznam si stránka stahuje čerstvý při každém otevření, takže se změna ukáže hned, bez čekání na mezipaměť telefonu. Každá položka:

```json
{
  "name": "Sui",                       // název na stránce
  "symbol": "SUI",                     // malý popisek pod názvem
  "logo": "../assets/logos/sui.png",   // logo (soubor dej do assets/logos/); bez loga se ukáže písmeno
  "url": "https://sui.io",             // kam se otevře po kliknutí
  "qty": 10,                           // celkem kusů = součet lotů (udržuje nástroj)
  "lots": [                            // nákupy: datum, kusy, cena v Kč za kus (zapisuje nástroj)
    { "date": "2026-10-10T08:00:00.000Z", "qty": 10, "price": 25.15 }
  ],
  "source": { "type": "coingecko", "id": "sui" }
}
```
Zdrojem pravdy jsou `lots`; podle nich stránka počítá kusy, vložené peníze, zisk i historii. `qty` je kopie pro starší verzi stránky v telefonu. Stránka ukáže hodnotu v Kč, v Pro režimu i růst.
(Komentáře `//` tu jsou jen pro vysvětlení, v souboru JSON být nesmí.)

Zdroje živé ceny (obojí zdarma, bez API klíče):

- `{ "type": "coingecko", "id": "<id mince>" }` – krypto, cena rovnou v Kč. Id je v URL na coingecko.com (`/coins/<id>`).
- `{ "type": "dexscreener", "chain": "solana", "address": "<adresa tokenu>" }` – tokenizované akcie (např. RoboStrategy **BOT**) a menší tokeny. Cena je v USD a převádí se na Kč aktuálním kurzem. Vybere se pár s největší likviditou. Tokenizované akcie se obchodují 24/7, takže cena se hýbe i o víkendu.

- `{ "type": "fixed", "priceUsd": 0.001 }` (nebo `"priceCzk"`) – pro něco, co se zatím neobchoduje: cena napsaná natvrdo, USD se přepočítá živým kurzem. U položky může být `"note": "zatím se neobchoduje"`, které se ukáže pod symbolem. Až se začne obchodovat, nahradí se zdroj za `coingecko` nebo `dexscreener`. S `"notTraded": true` se položka ukáže ztlumená, s popiskem „mimo součet“, a **nezapočítá se** do celkové hodnoty, růstu, podílů ani rozložení portfolia. Až se začne obchodovat, příznak odeber.

**Tržní kapitalizace** (Pro režim): u kryptoměn ji vrací CoinGecko. U tokenizovaných akcií se počítá jako živá cena × počet akcií firmy, který je v položce jako `"sharesOutstanding"` (např. BOT 24,4 mil., Tesla 3,237 mld., SpaceX 13,57 mld.). Je to přibližný, ručně zapsaný údaj, občas ho tedy aktualizuj. Bez `sharesOutstanding` se ukáže pomlčka.

Když se ceny nepodaří načíst, stránka ukáže poslední známé (uložené v telefonu) a upozorní na to.

## Růst portfolia a Pro režim

Od data startu se u každé položky v seznamu ukáže i malé procento (zelené plus nebo červené mínus) jejího vlastního růstu. Před startem se neukazuje.

Stránka ukazuje, o kolik % portfolio vyrostlo nebo kleslo **od předání**, a v Pro režimu (přepínač nahoře) cenu, zisk/ztrátu v Kč i %, změnu za 24 hodin a podíl každé položky, rozložení portfolia a slovníček investora.

Výchozí cena a nákupy se zapisují do `config.json` jako „loty“ (`lots`: datum, počet kusů, cena v Kč za kus). Zapisuje je nástroj, ruční úpravy ne:

```sh
# V den startu (např. 10. 10. 2026): zmrazí dnešní ceny jako výchozí bod (genesis).
# Napřed přepiš v config.json `qty` u každé položky na skutečný počet kusů, --force vychází z něj.
node tools/portfolio.mjs genesis all --force

# Později: nákup za částku nebo za počet kusů, za dnešní cenu
node tools/portfolio.mjs add p1 SUI --czk 200
node tools/portfolio.mjs add p2 BOT --qty 0.5
```

Úvodní portfolio se dá zadat rovnou **v korunách**; počty kusů se spočítají z cen v ten okamžik:

```sh
node tools/portfolio.mjs genesis all --amounts BOT=200,SPCX=100,TSLA=100,CARDS=200,SUI=200 --units ET10=100000 --start 2026-10-10
```
`--units` zapíše přesný počet kusů (u pevné ceny, třeba ET10), `--amounts` počítá kusy z korun.

Datum, které stránka ukazuje jako začátek sledování, je `startDate` v `config.json` (teď `2026-10-10`). Před tímto dnem stránka jen píše „Sledování růstu začne …“ a růst ani zisky nepočítá. Nastavit se dá i při zápisu snímku: `genesis all --force --start 2026-10-10`.

**Pozor, prodej zatím není ošetřený.** Nákupy a nové položky jsou v pořádku. Ale položku **nemazat** a **nesnižovat jí počet kusů** (ani ručně v `config.json`): zisk nebo ztráta z ní by zmizely z celkového růstu a procento by skočilo. Před prvním prodejem je potřeba do `tools/portfolio.mjs` doplnit příkaz `sell`, který si zapamatuje výnos z prodeje, a až pak prodej provést. Záznamy nákupů (`lots`) jsou na to už připravené, nic se nemusí převádět.

Nástroj zapíše všechny stránky najednou, nebo žádnou (když se nepodaří načíst cena). Datum u `--start` musí být ve tvaru `2026-10-10`.

Za proxy: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=<ca bundle> node tools/portfolio.mjs ...`.
Bez zapsaných nákupů (starý formát `qty`) se růst nezobrazí, ale hodnoty ano.
Nová položka: přidej ji do `config.json` s `"qty": 0` a pak ji koupí příkaz `add`.

## Historie nákupů (zdroj všech výpočtů)

Sekce „Historie nákupů“ na stránce ukazuje každý nákup jako blok: **Blok #0 je genesis** (startovní portfolio), další bloky jsou dokoupení, nejnovější nahoře. Nákupy zapsané ve stejné minutě tvoří jeden blok. Hodnoty, vložené peníze, zisky i celkový růst se počítají právě z těchto záznamů (`lots` v `config.json`), takže historie a čísla se nemohou rozejít. Dokoupení se zapisuje příkazem `add` a hned se ukáže jako nový blok.

## Motivy

Minecraft, Kirby, Waddle Dee, Pokémon, Make-up, Fotbal, Trader, Klavír, Kytara. Motiv se mění kulatým tlačítkem vpravo nahoře (otevře se výběr se všemi sedmi) a ukládá se do telefonu (`localStorage`), takže zůstane i po zavření stránky. `p2` začíná s Kirby (růžová), `p1` s Waddle Dee (modrá s oranžovou). Výchozí motiv je atribut `data-theme` v `index.html` stránky.

Všechny motivy mají stejnou stavbu: hlavička (název, přepínač Pro, tlačítko motivu), jedna karta s růstem portfolia a postavičkou, která se přes ní dívá, čistý seznam a jeden součet dole. Liší se barvami, rámečky, písmem a postavičkou (Kirby, Waddle Dee, Pikachu, creeper, rtěnka, míč, svíčkový graf, noty, hlava kytary). Barevný proužek pod růstem ukazuje, z čeho se portfolio skládá, a stejnou barvou je kroužek kolem loga každé položky.

Motivy jsou sady CSS proměnných na začátku `assets/style.css` (barvy, rámečky, stíny, písmo, velikost a poloha postavičky, paleta proužku `--a1` až `--a8`), pár drobných úprav je na konci bloku motivu. Postavičky a ikony jsou v `assets/icons.js` (`MICRO_PEEK`, `MICRO_TOTAL`, `MICRO_MARKS`; `MICRO_ICONS` používají i kartičky). Písma (Fredoka, Press Start 2P, Nunito, Lilita One) jsou uložená v `assets/fonts/`, stránka nestahuje nic zvenčí kromě cen.

## Heslo jako hádanka

Heslo je ukryté v **čísle na kartičce**. Stránka při prvním otevření jen řekne „Napiš heslo z kartičky“, jak se číslo luští, se dětem vysvětluje osobně (v aplikaci návod není). Pak si heslo telefon pamatuje. Je to hra, ne bezpečnost: číslo je na kartičce a `config.json` je veřejný, takže kdo si otevře zdrojový kód, uvidí počty kusů. Pro dětské portfolio to stačí.

Pravidlo: číslo na kartě má čtyři čtveřice číslic, součet číslic každé čtveřice je jedno náhodné jednociferné číslo (3 až 9) a obě karty mají stejný celkový součet 24, aby to nikdo neměl těžší. Heslo jsou ta čtyři čísla za sebou, např. součty 7, 4, 6, 7 dají heslo `7467`. S jménem to nesouvisí. Číslo karty i heslo se uloží do `private/passwords.json`, takže vytištěná karta zůstává platná.

```sh
node tools/password.mjs set p1      # vyrobí náhodné heslo a číslo karty: private/passwords.json + hash v p1/config.json
node tools/password.mjs card        # vypíše čísla karet a ověří, že se dají rozluštit
node tools/password.mjs remove p1   # zruší heslo, stránka se otevře rovnou (bez `passHash` v config.json se zámek nezobrazí)
```

`set` odmítne přepsat heslo, které už existuje (je vytištěné na kartě); `--new` ho přepíše a karta pak přestane fungovat. Po změně commitni a pushni `config.json` a vygeneruj znovu tiskové PDF (`npm run print`). Stránka (v `config.json` jako `passHash`) obsahuje jen pomalý hash hesla (PBKDF2-SHA256, 200 000 kol, sůl `micro-portfolio:<id>`). **iPhone:** Safari smaže data stránky, když ji člověk 7 dní v Safari neotevře; heslo se pak píše znovu (dá se zase rozluštit z karty). Pomůže „Přidat na plochu“.

## Kartičky

```sh
npm install                           # jednou (pro Chromium: npx playwright install chromium)
# jednou: vytvoř private/names.json, např. {"p1": "Jméno1", "p2": "Jméno2"}
npm run cards                         # vyrenderuje karty pro domácí tisk (výroba v tiskárně: `npm run print`)
npm run cards -- --base https://jina-adresa.cz/micro-portfolio   # jiná adresa v QR (jinak `baseUrl` z tools/people.json)
```

`tools/people.json` určuje, které stránky se mají vyrobit, jejich barvu a maskota. Výstup je v `private/cards/` (necommituje se): `<id>-front.png`, `<id>-back.png`, `<id>-card.pdf` (85,6 × 54 mm, 2 strany) a `karticky-A4.pdf` pro domácí tisk.

### Tiskové PDF pro výrobu plastových karet

`npm run print` (potřebuje Ghostscript `gs`, poppler-utils, Python 3 s `pikepdf` a `opencv-python-headless`) vyrobí `private/cards/karticky-tisk-CMYK.pdf`: 4 stránky 91,5 × 60 mm se spadávkou 3 mm (hotová karta 85,5 × 54 mm, rohy bez zaoblení), pořadí karta 1 přední, zadní, karta 2 přední, zadní. Barvy jsou v CMYK, vše je vektor (žádný rastr, text převedený do křivek), QR kód je vektorový černý (K 100 %) na bílém s 3 mm okolo a nejméně 5 mm od ořezu, v PDF jsou nastavené TrimBox a BleedBox. Na konci nástroj QR kódy z hotového PDF naskenuje zpět a ověří, že vedou na správné stránky. Vznikají dvě verze: `karticky-tisk-CMYK.pdf` bez značek (BlackCard je nechce) a `karticky-tisk-CMYK-se-znackami.pdf` s ořezovými značkami (M CARD je chce), stránky jsou tam větší (107,5 × 76 mm: grafika, spadávka a značky, TrimBox/BleedBox jsou nastavené). Vedle PDF vzniknou náhledy `tisk-nahled-*.png` a `tisk-nahled-znacky-*.png`. Design karet je v `tools/make-print.mjs`. Konverzi do CMYK dělá Ghostscript se svým výchozím profilem; pokud tiskárna vyžaduje konkrétní profil (např. ISO Coated v2), řekni a přidám ho.

**QR kódy se nemění** (vedou jen na stránku, nejsou v nich žádné tajné údaje). Heslo se mění jen když ho sám přepíšeš (`tools/password.mjs set`). Úpravy seznamu, cen i motivů je neovlivní. Nepřejmenovávej složky `p1/` a `p2/` (jsou v QR adrese). Nástroj odmítne vytvořit nové heslo pro stránku, která už jedno má, a vypíše, jak ho obnovit (heslo je napsané na kartičce).
