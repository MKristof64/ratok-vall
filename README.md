# Rátok vall

Letisztult, anonim társasági játék: hozz létre egy szobát, add meg a társaság tagjainak becenevét, majd oszd meg a meghívót. A résztvevők név és fiók nélkül írhatnak rövid mondatokat, és kiválaszthatják, kire gondoltak.

## Mit tud?

- fiók, e-mail és szerzőazonosító nélküli mondatbeküldés;
- e-mail/jelszavas házigazda-fiók és automatikus sajátjáték-mentés;
- saját játékok listázása, folytatása, megosztása és megerősített törlése;
- megosztható vendéghivatkozás és külön, titkos házigazda-kulcs;
- közös, élő gyűjtési és felfedési folyamat;
- opcionális `Célpont megnevezése` beállítás;
- a kikapcsolt célpontot a szerver sem küldi el a böngészőnek;
- bulihangulatú, reszponzív és WCAG AA-kontrasztra hangolt megjelenés;
- szobánként legfeljebb 300 mondat, szerveroldali atomikus korláttal;
- mobilon, billentyűzettel és képernyőolvasóval is használható felület;
- Cloudflare Worker-jelszókapu, aláírt munkamenet-cookie és D1 perzisztencia;
- sózott PBKDF2-SHA-256 fiókjelszavak és AES-256-GCM-mel titkosított meghívókódok.

## Adatvédelem

A játék a házigazda fiókjához e-mail-címet és jelszóellenőrzőt tárol, de a mondatbeküldésekhez nem ment beküldői nevet, fiókot, e-mail-címet, IP-címet, user-agentet vagy eszközazonosítót. A mondatokhoz nincs szerző rendelve. A Cloudflare a szolgáltatás működtetéséhez technikai hálózati adatokat kezelhet, ezért a megoldás alkalmazásszintű anonimitást biztosít, nem ígér teljes hálózati lenyomozhatatlanságot.

A megadott becenevek és mondatok a közös szoba részeként maradnak meg, amíg a házigazda a szobát a felületen nem törli. A törlés a kapcsolódó résztvevőket és mondatokat is eltávolítja.

A megosztott alkalmazásjelszó ellenőrzője, a munkamenet aláírókulcsa és a meghívókódok titkosítási kulcsa kizárólag Cloudflare runtime secret. Egyik sem kerül a GitHub-repóba vagy a klienscsomagba. A fiókjelszó csak egyedi sóval képzett PBKDF2-SHA-256 ellenőrzőként kerül D1-be; a visszafejthető meghívókódot az alkalmazás külön AES-256-GCM-titkosítással védi.

## Helyi fejlesztés

Követelmény: Node.js 22.13+ és pnpm.

```bash
pnpm install
pnpm run dev
```

Másold le az `.env.example` fájlt `.dev.vars` néven, és adj meg benne egy PBKDF2-SHA-256 jelszó-ellenőrzőt, egy véletlen, legalább 32 bájtos munkamenetkulcsot, valamint egy pontosan 32 bájtos, standard base64 formátumú szobatitkosítási kulcsot. A `.dev.vars` eleve ki van zárva a Gitből.

## Ellenőrzés

```bash
pnpm run db:generate
pnpm run lint
pnpm test
```

## Közzététel

A forrás nyilvános GitHub-repóban tartható, a futó alkalmazás viszont Cloudflare Worker/Sites környezetet igényel a D1, a szerveroldali jogosultságok és a biztonságos jelszókapu miatt. Statikus GitHub Pages kiadás nem alkalmas erre a védelmi modellre.

Telepítéskor állítsd be titkos környezeti értékként:

- `APP_PASSWORD_VERIFIER`
- `APP_SESSION_SECRET`
- `ROOM_DATA_ENCRYPTION_KEY` (pontosan 32 véletlen bájt standard base64 kódolással)

## Technológia

Vinext, React, Cloudflare Workers, Cloudflare D1, Drizzle ORM és Web Crypto API.

## Licenc

MIT
