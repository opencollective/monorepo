# German (`de`) Style Guide

Rules for `opencollective-frontend/lang/de.json`. Read this before translating, reviewing or bulk-editing German strings, so the catalog doesn't drift back to old mistranslations ("Kredit" for a ledger credit, "Finanzträger" for Fiscal Host, "Trinkgeld" for a platform tip). The terminology was set in https://github.com/opencollective/opencollective-frontend/pull/12429.

Priority when rules conflict: placeholders intact > financial accuracy > one term per concept > tone.

## Principles

1. **Financial accuracy first.** Open Collective is a financial tool. A German term that sounds natural but means something else in accounting is worse than a plain one. When in doubt, pick the term a German treasurer or accountant would use.
2. **One concept, one term.** Once a term is chosen, use it everywhere: labels, tooltips, emails, FAQ copy. Users must never wonder whether "Erstattung" and "Rückerstattung" are two different things. Match the glossary below, then the existing catalog.
3. **Address the user as "du", or not at all.** Never "Sie", never "ihr", even in copy about a Collective ("dein Kollektiv", not "euer Kollektiv"): one person is reading. Buttons, menu items and short labels use an infinitive or a noun ("Speichern", "Ausgabe einreichen", "Hier klicken"), not "Speichere" or "Klicken Sie". Status messages are impersonal ("Wird gespeichert …"). See [Addressing the user](#addressing-the-user).
4. **Keep the brand.** "Open Collective" is never translated ("Offenes Kollektiv", "Öffne Kollektiv" were real bugs). In compounds, hyphenate: "Open-Collective-Konto", "Open-Collective-Plattform".
5. **No gender-inclusive forms for now.** No "Unterstützer:innen", "Unterstützer\*innen" or "UnterstützerInnen". Prefer a neutral word when a natural one exists ("Mitwirkende", "Teilnehmende", "Admins", "Team", "Person"), otherwise the standard form ("Unterstützer"). Don't force participles like "Unterstützende".
6. **Never rename placeholders.** ICU argument names (`{amount}`), rich-text tag names (`<Link>`, `<Expense>`, `<Individual></Individual>`) and plural/select keys (`one`, `other`, `ORGANIZATION`) stay exactly as in English. Translated tag names (`<Einzelperson>`, `<Betrag>`) or keys (`ORGANISATION`) break rendering. The German text around them can be restructured freely, including moving words into plural branches (see [Grammar pitfalls](#grammar-pitfalls)).

## Key terms

The four most visible terms in the product. Get these right before anything else.

| English         | German          | Notes                                                                                                                                                                                                                                                                        |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Collective | Open Collective | Brand name, never translated and never one word ("OpenCollective"). Hyphenate in compounds: "Open-Collective-Konto".                                                                                                                                                         |
| Collective      | Kollektiv       | Neuter: das Kollektiv, die Kollektive, den Kollektiven. Never leave "Collective" in English inside a German sentence ("Collective-Genehmigung" → "Kollektiv-Genehmigung").                                                                                                   |
| Organization    | Organisation    | German spelling with "s": die Organisation, die Organisationen.                                                                                                                                                                                                              |
| Fiscal Host     | Fiscal Host     | Kept in English. Masculine: der Fiscal Host, des Fiscal Hosts, die Fiscal Hosts. The service is "das Fiscal Hosting". Hyphenate compounds fully: "Fiscal-Host-Admin", "Fiscal-Host-Konto". Never "Finanzträger", "Träger", "Fiskalgastgeber", "Fiskalwirt" or "Steuer-Host". |

Brand names containing these words stay in English and unhyphenated: "Open Source Collective", "Open Collective Foundation".

## Glossary

### Accounts and roles

| English             | German            | Notes                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fiscal host admin   | Fiscal-Host-Admin |                                                                                                                                                                                                                                                                              |
| Host fee            | Host-Gebühr       | Matches the English setting. In longer explanations "Overhead" is also understood.                                                                                                                                                                                           |
| Fund (account type) | Fonds             | Same form singular and plural. "Fond" is a different word. "Mittel" means money in general, not an entity: "Funds & Grants" (the menu group of hosted Funds) is "Fonds & Förderungen", but "managed funds", "operational funds", "unhosted funds", "add funds" are "Mittel". |
| Plan (subscription) | Tarif             | der Tarif, die Tarife. Not "Plan" / "Pläne".                                                                                                                                                                                                                                 |
| Grantmakers         | Förderer          | Those who give grants. "Förderorganisationen" and "Stiftungen" also work in prose. Not "Fördermittelgeber" (heavier) or "Stipendiaten" (recipients, the opposite).                                                                                                           |
| Grantees            | Geförderte        | Those who receive grants.                                                                                                                                                                                                                                                    |

### Money flows

| English                 | German                     | Notes                                                                                                                                                                                                     |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Financial contributions | finanzielle Beiträge       | Not "Finanzbeiträge" or "Zuwendungen".                                                                                                                                                                    |
| Contribution            | Beitrag                    | Not "Spende". Many contributions are not donations in the tax sense (memberships, tickets, services), and "Spende" implies tax-deductible giving. Keep "Spendenquittung" only for that specific document. |
| Recurring contribution  | Wiederkehrender Beitrag    |                                                                                                                                                                                                           |
| Contribution tier       | Beitragsstufe              |                                                                                                                                                                                                           |
| Expected funds          | Erwartete Zahlungseingänge | Money announced but not yet received. "Erwartete Mittel" / "Erwartete Fonds" were vague or wrong.                                                                                                         |
| Add funds               | Mittel hinzufügen          | Here "Mittel" (money in general) is correct.                                                                                                                                                              |
| Disputed contributions  | Angefochtene Beiträge      |                                                                                                                                                                                                           |

### Ledger and balances

| English                                    | German           | Notes                                                                                                                  |
| ------------------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Credit (transaction type)                  | Gutschrift       | "Kredit" means a loan.                                                                                                 |
| Debit (transaction type)                   | Belastung        | "Lastschrift" is a payment method (direct debit, SEPA-Lastschrift). Keep "Lastschrift" only for those payment methods. |
| Balance                                    | Kontostand       | General, neutral, can be negative. Not "Saldo".                                                                        |
| Balance with a provider (Wise, PayPal)     | Guthaben         | "{service}-Guthaben".                                                                                                  |
| Balance account (accounting category kind) | Bestandskonto    | "Bestands- und Verrechnungskonten". Only in accounting setup.                                                          |
| Total balance                              | Gesamtkontostand | Consistent with "Kontostand".                                                                                          |
| Available funds / positive balance         | Guthaben         | Only where the text is clearly about money available to spend.                                                         |
| Transaction                                | Transaktion      | "Buchung" is acceptable in accounting-heavy contexts, but prefer "Transaktion" in UI labels.                           |

### Accounting

Chart of accounts, categories, exports, bank imports. Readers are accountants, so use their terms.

| English                                       | German                        | Notes                                                                                                |
| --------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Ledger                                        | Hauptbuch                     | "im Hauptbuch", "Hauptbuch-Transaktion", "Hauptbuchdaten". Not "Ledger".                             |
| Chart of accounts                             | Kontenplan                    | Not "Kontendiagramm".                                                                                |
| Accounting category                           | Buchungskategorie             | Not "Buchhaltungskategorie".                                                                         |
| Balance / clearing account                    | Bestands- / Verrechnungskonto |                                                                                                      |
| Debit / credit (export columns, double entry) | Soll / Haben                  | In accounting exports only. Transaction types in the UI stay Belastung / Gutschrift.                 |
| Reconcile                                     | abgleichen                    | "Transaktionen abgleichen".                                                                          |
| Off-platform                                  | außerhalb der Plattform       | "Transaktionen außerhalb der Plattform". Not "Off-Platform".                                         |
| Fiscal year                                   | Geschäftsjahr                 |                                                                                                      |
| VAT                                           | MwSt.                         | "MwSt.-Einstellungen". The VAT number is "USt-IdNr.".                                                |
| Liability (legal)                             | Haftung                       | In this product "liability" is legal liability, not balance-sheet liabilities ("Verbindlichkeiten"). |
| Accountant                                    | Buchhalter                    |                                                                                                      |

### Expenses

| English                                          | German                 | Notes                                                                                                                                                                                        |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expense                                          | Ausgabe                | Not "Kosten" or "Spesen". "Ausgabenverwaltung", "Ausgabenrichtlinie". Keep "Kosten" only where English says costs.                                                                           |
| Reimbursement (expense type, UI label "Receipt") | Kostenerstattung       | Getting paid back for something you bought.                                                                                                                                                  |
| Refund (of a payment)                            | Rückerstattung         | Money returned to a contributor. Not a bare "Erstattung". Keep separate from Kostenerstattung.                                                                                               |
| Payment processor                                | Zahlungsabwickler      | Not "Zahlungsdienstleister" or "Zahlungsanbieter". Fees: "Gebühren des Zahlungsabwicklers".                                                                                                  |
| Receipt (generic proof of purchase or payment)   | Beleg                  | "Quittung" is narrower (a signed acknowledgment of cash received). "Beleg" covers invoices, card slips and payment confirmations. Dative plural: "Belegen".                                  |
| Invoice                                          | Rechnung               |                                                                                                                                                                                              |
| Grant                                            | Förderung              | Feminine: die Förderung, die Förderungen. Compounds: "Förderantrag", "Fördersumme", "Förderzeitraum". "Fördermittel" for the money itself. Not "Zuschuss" (reads as a small top-up subsidy). |
| Grant request                                    | Förderantrag           | A formal request for money, so an "Antrag". The form is "Antragsformular". Submitted grant requests are "eingereicht", not "ausgestellt" (issued, like a document).                          |
| Allow grants (expense policy)                    | Förderanträge erlauben | Same pattern as "Rechnungen erlauben" and "Belege erlauben". Not "Förderungen gewähren" (awarding grants).                                                                                   |
| Payout method                                    | Auszahlungsmethode     |                                                                                                                                                                                              |

### Platform tips

| English                                  | German        | Notes                                                         |
| ---------------------------------------- | ------------- | ------------------------------------------------------------- |
| Platform tip                             | Plattform-Tip | Masculine: der Tip, einen Tip, des Tips. Plural: Tips.        |
| Tip jar (a simple one-off donation page) | Spendenbox    | Not "Tip". A crowdfunding format, unrelated to platform tips. |

"Tip", not "Tipp" or "Trinkgeld", on purpose. Duden spells it "Tipp", and "Tip" is the pre-1996 spelling, but "Trinkgeld" suggests a gratuity for a waiter, "Tipp" mostly means a hint ("ein guter Tipp"), and "Tip" follows the English product name so it stays recognizable across languages. Don't "correct" it to "Tipp". "Tippe, um …" (tap to …) is a different verb and correct as is.

### Applications

German separates two things English calls "application":

| English                                           | German                | Notes                                                                                            |
| ------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Host application (applying to join a Fiscal Host) | Bewerbung             | Applying to be accepted. "sich bewerben", "Bewerbungsformular", "Bewerbung annehmen / ablehnen". |
| Grant request, funding application                | Antrag / Förderantrag | A formal request for money. "beantragen", "Antragsformular", "Antrag genehmigen".                |
| App (software, OAuth)                             | App                   | See [English terms we keep](#english-terms-we-keep).                                             |

A bare "Applications" or "No applications" can be any of these: find where the id is used before translating.

### People

| English                                                                   | German       | Notes                                                                                                                           |
| ------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Contributor / backer (gives money)                                        | Unterstützer | der Unterstützer, die Unterstützer, den Unterstützern. Not "Beitragende" or "Beitragszahler".                                   |
| Contributor (gives time or work: code, volunteering, submitting expenses) | Mitwirkende  | Only when the person helps with work, not money.                                                                                |
| User                                                                      | Nutzer       | der Nutzer, die Nutzer, "Nutzerkonto". Not "Benutzer". "benutzerdefiniert" and "benutzerfreundlich" stay, they are fixed words. |

## English terms we keep

Target the tone of modern German apps like N26 or Trade Republic: established English product words stay in English, money and legal terms stay in German.

**Keep in English:**

| English                                                                                                                       | Don't use                 | Gender / plural and notes                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Update (a Collective's post)                                                                                                  | Aktualisierung, Neuigkeit | das Update, die Updates. "Aktualisierung" sounds like a software update. Keep "aktualisieren" for the verb (to update a setting). |
| Event (account type)                                                                                                          | Veranstaltung             | das Event, die Events. Watch the gender: "dieses Event", "ein neues Event". Compounds: "Event-Seite".                             |
| Community                                                                                                                     | Gemeinschaft              | die Community. Real German compounds like "Gemeinschaftsgarten" stay.                                                             |
| App (software, OAuth)                                                                                                         | Anwendung                 | die App, die Apps. A host application is not an app, that's a "Bewerbung".                                                        |
| Fiscal Host, Fiscal Hosting                                                                                                   | Finanzträger              | See [Key terms](#key-terms).                                                                                                      |
| Dashboard, Team, Admin, Checkout, Feedback, Webhook, Token, Link, Ticket, Crowdfunding, Sponsor, Tip, Newsletter, Open Source |                           | Already in use, keep them.                                                                                                        |

**Keep in German even though English is tempting:**

- Money and legal terms: Konto, Kontostand, Beleg, Rechnung, Gebühr, Überweisung, Auszahlung. Banks and tax offices use these words, and so do German banking apps.
- Tier → Stufe ("Tier" means "animal" in German).
- Contribution → Beitrag.

### Register intentional English in `IGNORED`

A string kept in English on purpose is identical to `en.json`, so `show-untranslated.ts de` lists it and the weekly `[i18n-de]` run will translate it back ("Fiscal Host" → "Finanzträger", "Community" → "Gemeinschaft") unless its **id** is in `IGNORED.de` in `opencollective-frontend/scripts/i18n/translation-stats.ts` (one id per line with a short comment, see the `es` list). Ignoring is by id, not by English value.

- When `show-untranslated.ts de` lists an id whose English value is a term this guide keeps in English, add the id to `IGNORED.de`. Do not translate it.
- Whenever a new term is kept in English, add its ids to `IGNORED.de` in the same change.

Ids that are English by design and must be in `IGNORED.de`:

| Id                             | Value          | Why          |
| ------------------------------ | -------------- | ------------ |
| `community`                    | Community      | Kept English |
| `ContributionType.Event`       | Event          | Kept English |
| `Events`                       | Events         | Kept English |
| `editCollective.fiscalHosting` | Fiscal Hosting | Key term     |
| `Fiscalhost`                   | Fiscal Host    | Key term     |
| `helpAndSupport.fiscalHosts`   | Fiscal Hosts   | Key term     |
| `updates`                      | Updates        | Kept English |
| `VVgt/a`                       | Update #{id}   | Kept English |

## Addressing the user

"du", like N26 and Trade Republic. It fits Open Collective's direct, informal English and its community audience. Seriousness comes from the writing, not from "Sie": precise terms, short sentences, no exclamation marks in errors or money confirmations, no slang.

| Where                                     | Form                     | Example                                                 |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------- |
| Buttons, menu items, tabs, column headers | Infinitive or noun       | "Speichern", "Ausgabe einreichen", "Einstellungen"      |
| Instructions and help text                | du, imperative           | "Gib den Betrag ein", "Prüf deine Angaben"              |
| Progress and status messages              | Impersonal or passive    | "Wird gespeichert …", "Deine Ausgabe wurde eingereicht" |
| Errors                                    | Describe problem and fix | "Die E-Mail-Adresse ist ungültig."                      |
| Copy about a Collective or team           | du, singular             | "dein Kollektiv", never "euer"                          |

One exception: text a Collective sends to a group keeps the plural. The pre-filled message to contributors (`n5Dv18`, "Hallo zusammen, … wir freuen uns auf eure Beiträge!") addresses all of them, so "eure" is correct there.

When converting old text: "Sie" at the start of a sentence can mean "they" ("Sie können …" about Fiscal Hosts), and "ihr/ihre" can mean "her/their". Compare with the English before changing them.

## Tone

- **Short, plain sentences.** Say what happens, then stop. "Keine Überweisung ohne dein Okay" beats "Es erfolgt keine Überweisung ohne vorherige Zustimmung".
- **Active voice, "wir" for Open Collective.** "Wir benachrichtigen deine Unterstützer" rather than "Deine Unterstützer werden benachrichtigt" when Open Collective is the actor.
- **No administrative German.** Avoid noun chains ("Durchführung der Erstattung") where a verb works ("die Erstattung durchführen").
- **Instructions are direct imperatives.** "Prüf deine Angaben, bevor du die Bewerbung einreichst", not "Es wird empfohlen, die Angaben zu prüfen".
- **Explain bureaucratic terms where they appear.** Help text can say what a term means in half a sentence.
- **Short friendly asides are fine in help text** ("Zum Glück …", "Kleiner Tipp: …"), never in errors or financial confirmations.
- **Idioms are fine in marketing and help pages, not in UI labels.** "Wir halten dir den Rücken frei" works on a landing page. A button says "Ausgabe einreichen".

## Grammar pitfalls

- **Dative plural of Beleg.** "Quittungen" has one plural form, but "Belege" becomes "Belegen" in the dative: "auf Belegen erscheinen", "mit Belegen im Anhang". Check this whenever you swap terms.
- **Plurals and trailing clauses.** If the verb after a plural block depends on the count, move it inside each branch: `{count, plural, one {… ist pausiert und <Link>kann fortgesetzt werden</Link>} other {… sind pausiert und <Link>können fortgesetzt werden</Link>}}.`
- **Interpolated nouns without an article.** Values like `{accountType}` come from `formatCollectiveType` and are bare nouns ("Kollektiv", "Projekt"). "Für {accountType} entsteht …" renders without an article. Put the value in parentheses or apposition: "Der Kontostand ({accountType}) wird negativ …".
- **Compound hyphenation.** Hyphenate when a compound contains a placeholder, a brand or an English term: "{taxName}-Nummer", "Open-Collective-Konto", "Plattform-Tip-Betrag".
- **Gender and plural after a term swap.** "Zuschuss" (masculine) → "Förderung" (feminine) changes every article; "Pläne für Fiscal Host" needed "Fiscal Hosts"; "Veranstaltung" (feminine) → "Event" (neuter) changes "diese" to "dieses".
- **Typography.** German quotation marks („…“), including around placeholders (`„{name}“`); a space before percent signs (`15 %`); "z. B." and "d. h." with a space; "…" instead of three dots, with a space before a trailing ellipsis ("Länder suchen …", "Wird gespeichert …"); a spaced en dash (" – ") for a dash in a sentence, never an em dash.

## Shared message ids

One English id is often reused in several places. When German needs different words in those places, no single translation is right everywhere. Example: "About" was both the menu link to Open Collective's About page ("Über uns") and the heading of a Collective's About section ("Info"); German showed a bare "Über".

- **Don't pick a compromise translation.** The fix is in code: give the other place its own message, reusing an existing one when it fits (the menu now uses the "About Us" message `ZjDH42`). If the task is limited to `lang/de.json`, translate for the most visible usage and report the id as needing a code split.
- **Two ids with the same English text are allowed only on purpose.** `npm run build:langs` fails on duplicate English strings unless they are listed in `DUPLICATED_IGNORED_MESSAGES` in `scripts/i18n/translate.js`, with a comment saying why the translation depends on context ("apply": "Bewerben" vs "Anwenden").
- **Watch for bare prepositions.** A German label that is only "Über", "Seit" or "Von" usually means the English was a fragment that German can't leave unfinished. "Von" and "An" are fine as From/To field labels. "Seit" as a column header became "Dabei seit".

## Deliberate choices

- `Transaction.kind.APPLICATION_FEE` stays "Anwendungsgebühr". It is the Stripe application fee that moves a platform tip to OFiTech. Keep the literal translation of the English label; don't add "Stripe", since the English doesn't say it.

## References

Two German organizations in our space write the kind of German we want. Use them for terminology and tone, not for proofreading: both have typos.

- **interalia** ([interalia.host/de](https://interalia.host/de/)), a German Fiscal Host (gGmbH) writing for our audience. Says "Fiscal Host" and "Fiscal Hosting" throughout (introduced once as "sogenannter Fiscal Host"), which is why we dropped "Finanzträger". Keeps English terms like Updates, Communities, Feedback, Services, Best Practices, while money terms stay German (Fördermittel, Überweisung, Budget, Finanzberichte). Uses "Förderung" / "Fördermittel" for grants and "Spenden" only for actual donations.
- **Prototype Fund** ([prototypefund.de](https://www.prototypefund.de/)), a German public funding program for open-source developers, the grant-giving side of our space. Uses "Förderung" for grants (with "Fördersumme", "Förderzeitraum", "Förderantrag", "Förderer", "Geförderte"), and separates "Bewerbung" (applying to be selected) from "Antrag" (the formal request for money), the split we follow. Keeps even more English than we do (Community, Demo Day, Kick-Off, Timeline, Coaching, Mentoring, Maintainer, Tools, Feedback). Instructions are direct imperatives with short friendly asides.
- **Don't copy from either:** gender-inclusive forms ("Akteur:innen", "Entwickler\*innen"); "ihr" (both address teams, our UI speaks to one person); their spelling and typography (Prototype Fund uses hyphens in date ranges where German uses an en dash: "1.–30. November").

## Review checklist for terminology changes

Most mistakes in the big terminology passes came from swapping terms by matching English words without looking at where the string is used. Before submitting a terminology change:

1. **Check where short strings are used.** For every changed string of three words or fewer, `rg` its id in `components/`, `lib/` and `pages/`. "Applications", "Funds", "Host", "About" and "Since" all have more than one meaning.
2. **Re-read compound labels built from swapped terms.** "Host-Unterstützer", "Gehostete Förderanträge" and "Administrationsübersicht" were grammatical but meant nothing. Prefer a short phrase ("Unterstützer des Fiscal Hosts", "Förderanträge an gehostete Fonds") over an opaque compound.
3. **Check endings after the swap.** See gender and plural under [Grammar pitfalls](#grammar-pitfalls).
4. **Grep the catalog for the old term and near-synonyms.** After replacing a term, the old word, its compounds and synonyms ("Plan" / "Tarif", "Mittel" / "Fonds") often still appear elsewhere.
5. **Run the catalog-wide checks.** Search for the forbidden terms in the glossary ("Saldo", "Zahlungsdienstleister", "Benutzer", bare "Host", "Zuschuss", "Trinkgeld", "Quittung"), three dots, straight quotes, "z.B.", "Sie " as address. After any regex-based fix, check that quotes are still balanced: a quote regex that crosses a placeholder breaks the string.
6. **Compare the sentence with the English, not just the term.** `GiJCGt` once said "Es sind Ausgaben …" (these are expenses) for "This Expense is …". Term swaps don't catch that kind of error.

## Validation before submitting

1. Every message parses with the FormatJS ICU parser (`@formatjs/icu-messageformat-parser`).
2. Argument names, tag names and plural/select keys match `lang/en.json` exactly.
3. Message keys are unchanged, and the key set matches `lang/en.json`.
4. `npx prettier --write lang/de.json` leaves no diff.
5. `npx tsx scripts/i18n/show-untranslated.ts de` prints only real translation work (intentional English is in `IGNORED.de`).
