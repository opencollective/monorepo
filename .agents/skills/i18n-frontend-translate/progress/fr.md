# French catalog review: progress

Tracks bringing `lang/fr.json` in line with [`references/fr.md`](../references/fr.md). Tick items as they land, note the PR, and delete this file when the review is done. Counts come from an audit on 2026-11-02 (5,092 messages) and are approximate: re-run the grep before starting a batch.

## 1. Broken messages

These fail the ICU/placeholder check against `lang/en.json`. Fix them first.

- [ ] `kh8yZm`: does not parse (`<Fonds attendus</Expense>`).
- [ ] `ContributeFAQ.Policy.Title`: `{Name}` instead of `{name}`.
- [ ] `mLRswr`: `{valeur}` instead of `{value}`.
- [ ] `createcollective.opensource.p2`: missing `{osclink}` / `{criterialink}`.
- [ ] `pricing.newModel.onLegacyPricing`: `<LinkLegacyPricing>` instead of `<LinkNewPricing>`.
- [ ] `signup.individual.tosAgreement`: tags renamed to lowercase (`<tosLink>`, `<privacyPolicyLink>`), `{newLine}` missing.
- [ ] `zh1XTV`: still English, `{accountType}` missing.
- [ ] `WR7z/n`: no `zero` branches (check whether English needs them at all).

## 2. Mistranslations found during the audit

- [ ] `e2zrxE`: "Présentation récurrente confirmée" for "Recurring contribution confirmed".
- [ ] `VVgt/a`: "Mettre à jour #{id}" for the noun "Update #{id}" (should be "Actualité n° {id}").
- [ ] `editCollective.fiscalHosting`: "Hôte fiscal" for "Fiscal Hosting" (should be "Hébergement fiscal").
- [ ] `AccountType.Individual`: "Individuel" (should be "Personne").
- [ ] `Payout`: "Remboursement"; `Payouts`: "Paiements sortants" (should be "Versement(s)").
- [ ] `transactions.downloadinvoicesbutton`: "Télécharger les factures" for "Download Receipts".
- [ ] `AudienceBreakdown.coreContributors`: "administrateurs" for "core contributors".
- [ ] `nt19l4`: "auprès vous" (missing "de qui").
- [ ] `NotificationsSettings.NecessaryNotifications.MagicLink`: typo "Connexien".
- [ ] `Expense.Type.Settlement`: typo "Réglement".
- [ ] `subscription.cancel.question`: "souscription".
- [ ] Brand translated: `becomeAHost.caseStudies.wwcode` ("Collectif ouvert"), `howItWorks.description` ("Open Collectif"). No elision: `createFund.tos.label`, `OC.tos.label`, `SE0Wpk` ("de Open Collective").
- [ ] Activity log without "a": `2FxRMv`, `6J42kW`, `6JDhU5`.
- [ ] On hold shown as "En attente", like Pending: `bLx/Q9`, `expense.onHold`, `PQoBVd`, `transaction.onHold` (should be "En suspens").

## 3. Untranslated strings

- [ ] About 110 ids are still identical to English and not in `IGNORED.fr`, although `lib/constants/locales.js` shows 100%. Most are host-application review strings (`HostApplication.*`), US tax forms (`TaxableCountry.*`, `taxFormThresholds.*`, `USPerson.*`) and `UserPicker.*`. List: `npx tsx scripts/i18n/show-untranslated.ts fr`.
- [ ] Remove from `IGNORED.fr` the ids the guide now translates: `Email` ("E-mail"), `ContributionType.Ticket` and `section.tickets.title` ("Billet", "Billets").

## 4. Term migrations

One term per batch, following the review checklist in the guide.

| Done | From                                                        | To                                    | Approx. strings                                    |
| ---- | ----------------------------------------------------------- | ------------------------------------- | -------------------------------------------------- |
| [ ]  | "mise à jour" as the noun for a Collective post, "nouvelle" | actualité                             | up to 64 (mixed with the verb)                     |
| [ ]  | "palier", "niveau" for tiers                                | formule                               | 23                                                 |
| [ ]  | "méthode / mode de paiement", "méthode de remboursement"    | moyen de paiement / mode de versement | 67 (split by payment vs payout)                    |
| [ ]  | "paiement", "remboursement" for payouts                     | versement                             | 24                                                 |
| [ ]  | expense type "Reçu" / "Remboursement"                       | note de frais                         | ExpenseTitle, ExpenseForm.ReceiptLabel and related |
| [ ]  | "reçu" for expense attachments                              | justificatif                          | 22                                                 |
| [ ]  | "carte de crédit"                                           | carte bancaire                        | 22                                                 |
| [ ]  | "processeur / fournisseur de paiement"                      | prestataire de paiement               | 15                                                 |
| [ ]  | "balance"                                                   | solde                                 | 14                                                 |
| [ ]  | "individu", "individuel"                                    | personne                              | 9                                                  |
| [ ]  | "registre" (ledger), "tableau de comptes"                   | grand livre, plan comptable           | 6 + 3                                              |
| [ ]  | "commission de l'hôte", "frais d'hébergement"               | frais de l'hôte                       | ~6                                                 |
| [ ]  | "bailleurs de fonds"                                        | financeurs                            | 3                                                  |
| [ ]  | "boîte à pourboires"                                        | cagnotte                              | 1                                                  |
| [ ]  | "pourboires de la plateforme" and other variants            | pourboire pour la plateforme          | ~16                                                |
| [ ]  | "email", "courriel", "mail"                                 | e-mail                                | 44                                                 |
| [ ]  | "Éditer", "sauvegarder", "réglages"                         | modifier, enregistrer, paramètres     | 8 + 6 + 10                                         |
| [ ]  | "accord" (host agreements)                                  | convention                            | 24                                                 |
| [ ]  | "télécharger" for uploads                                   | importer                              | 13                                                 |

## 5. Capitalization and calques

- [ ] Lowercase product nouns mid-sentence: "Collectif" (~250), "Hôte" (~105), "Organisation" (~80), plus "Projet", "Événement", "Fonds", "Compte".
- [ ] Sentence case in labels ("Fonds Ajoutés", "Hôtes Fiscaux", "Nom Légal").
- [ ] "avec succès" (38), "Êtes-vous sûr" (37), "basé sur", "supporté", "initié", "non trouvé", "S'il vous plaît", "(e)" forms.

## 6. Typography

- [ ] Straight double quotes to « » (37), "..." to "…" (40), "’" to "'" (33), "ex:" to "Ex. :", space before "%" and before "? ! ;" where missing, em dashes.

## 7. Read-through by area

After the mechanical passes, read each area in context for calques and tone: contribution flow, expense flow, host dashboard, accounting and exports, settings, marketing pages (`home.*`, `becomeAHost.*`, `solutions.*`, `pricing.*`).
