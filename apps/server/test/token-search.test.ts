/**
 * Pourquoi certains jetons étaient introuvables.
 *
 * Trois signalements successifs — l'Esprit 3/2 rouge-blanc, les deux Insectes
 * de `tdsc`, l'Esprit de Tarkir : Dragonstorm — désignaient tous des jetons
 * **présents en base**. Ce n'est pas l'ingestion qui les perdait, c'est la
 * réponse de la recherche qui les coupait : depuis qu'un jeton n'est plus
 * dédoublonné, « Spirit » compte une centaine d'impressions, et vingt places ne
 * suffisaient plus. Pire, toutes ces lignes étant parfaitement à égalité au
 * classement, c'est Postgres qui décidait lesquelles survivaient.
 *
 * Ces tests tiennent les deux garde-fous qui empêchent la récidive : une
 * réponse assez large pour la plus grosse famille de jetons, et un ordre qui
 * sort une illustration de chaque jeton distinct avant la deuxième d'un autre.
 */
import { describe, expect, it } from 'vitest';

process.env['DATABASE_URL'] ??= 'postgresql://mtg:mtg@localhost:5432/mtg';
process.env['SESSION_SECRET'] ??= 'secret-de-test-assez-long-pour-passer-la-validation';
process.env['SCRYFALL_USER_AGENT'] ??= 'mtg-vtt-test/1.0';
process.env['ARCHIDEKT_USER_AGENT'] ??= 'mtg-vtt-test/1.0';

const { buildSearchSql, DEFAULT_TOKEN_LIMIT, MAX_SEARCH_LIMIT } = await import('../src/cards/search.js');
const { isTokenCard } = await import('../src/cards/scryfall.js');

/**
 * La famille de jetons la plus nombreuse au 16 septembre 2026 : 99 impressions
 * anglaises du seul nom « Spirit ». Une réponse plus courte que cela cache
 * forcément un Esprit à quelqu'un.
 */
const PLUS_GROSSE_FAMILLE = 99;

describe('recherche de jeton', () => {
  it('rend assez de résultats pour la plus grosse famille de jetons', () => {
    expect(DEFAULT_TOKEN_LIMIT).toBeGreaterThan(PLUS_GROSSE_FAMILLE);
    expect(MAX_SEARCH_LIMIT).toBeGreaterThanOrEqual(DEFAULT_TOKEN_LIMIT);
  });

  it('applique ce plafond large à une recherche de jeton, pas celui des cartes', () => {
    const jetons = buildSearchSql({ query: 'spirit', tokensOnly: true });
    expect(jetons?.values).toContain(DEFAULT_TOKEN_LIMIT);

    const cartes = buildSearchSql({ query: 'spirit', excludeTokens: true });
    expect(cartes?.values).not.toContain(DEFAULT_TOKEN_LIMIT);
  });

  it('ne dédoublonne aucune impression de jeton', () => {
    const sql = buildSearchSql({ query: 'insect', tokensOnly: true })?.sql ?? '';
    // L'identité d'un jeton est son impression : deux illustrations du même
    // Insecte 1/1 vert sont deux résultats, pas un.
    expect(sql).toContain('PARTITION BY "scryfallId"');
    expect(sql).not.toContain('PARTITION BY "normalizedName", "isToken"');
  });

  it('sort une illustration de chaque jeton distinct avant la deuxième d’un autre', () => {
    const sql = buildSearchSql({ query: 'insect', tokensOnly: true })?.sql ?? '';
    // Le rang porte sur ce qui distingue vraiment deux jetons sur la table.
    expect(sql).toContain('PARTITION BY "normalizedName", "typeLine", "power", "toughness", "colors"');
    // …et il passe avant la similarité dans le classement final, sinon les
    // quarante Insectes verts repoussent le B/G de `tdsc` hors de la réponse.
    expect(sql).toMatch(/ORDER BY contains DESC, prefix DESC, variant_rank ASC/);
  });

  it('ordonne de façon déterministe, à égalité parfaite', () => {
    const sql = buildSearchSql({ query: 'spirit', tokensOnly: true })?.sql ?? '';
    // Sans clé de départage, cent « Spirit » strictement à égalité laissaient
    // Postgres rendre la page qui l'arrangeait, et deux recherches identiques
    // ne donnaient pas le même résultat.
    expect(sql).toMatch(/"setCode" ASC, "collectorNumber" ASC/);
  });

  it('n’exige pas l’anglais d’un jeton, mais l’exige d’une carte', () => {
    /*
     * Le bulk ne porte qu'une ligne par impression : l'anglaise quand elle
     * existe, sinon l'unique langue de parution. Exiger l'anglais n'écartait
     * donc aucun doublon de jeton — seulement les impressions japonaises qui
     * n'existent qu'en japonais, dont l'Esprit 3/2 rouge-blanc de `wmom`.
     */
    expect(buildSearchSql({ query: 'spirit', tokensOnly: true })?.sql).not.toContain(`"lang" = 'en'`);
    expect(buildSearchSql({ query: 'spirit', excludeTokens: true })?.sql).toContain(`"lang" = 'en'`);
  });

  it('cherche un jeton par sa taille, « spirit 3/2 » comme on le dit à voix haute', () => {
    const sql = buildSearchSql({ query: 'spirit 3/2', tokensOnly: true })?.sql ?? '';
    expect(sql).toContain('coalesce("power", \'\')');
    expect(buildSearchSql({ query: 'spirit 3/2', tokensOnly: true })?.values).toContain('spirit 3/2');
  });
});

describe('reconnaissance d’un jeton à l’ingestion', () => {
  it('reconnaît un jeton ordinaire à sa disposition', () => {
    expect(isTokenCard({ id: 'x', name: 'Insect', lang: 'en', layout: 'token', set: 'tdsc', set_name: 'x', collector_number: '12', type_line: 'Token Creature — Insect' })).toBe(true);
  });

  it('reconnaît un jeton réversible, dont la ligne de type n’est que dans les faces', () => {
    /*
     * Le cas Mechtitan (`sld` 1969) : Scryfall ne donne aucune `type_line` au
     * premier niveau d'une carte réversible. Ne regarder que ce niveau le
     * classait parmi les cartes ordinaires, et la recherche de jeton ne pouvait
     * plus le trouver.
     */
    expect(
      isTokenCard({
        id: 'y',
        name: 'Mechtitan // Mechtitan',
        lang: 'en',
        layout: 'reversible_card',
        set: 'sld',
        set_name: 'Secret Lair Drop',
        collector_number: '1969',
        card_faces: [
          { name: 'Mechtitan', type_line: 'Token Artifact Creature — Robot' },
          { name: 'Mechtitan', type_line: 'Token Artifact Creature — Robot' },
        ],
      }),
    ).toBe(true);
  });

  it('ne prend pas une carte ordinaire ni un emblème pour un jeton', () => {
    expect(isTokenCard({ id: 'a', name: 'Sol Ring', lang: 'en', layout: 'normal', set: 'c21', set_name: 'x', collector_number: '1', type_line: 'Artifact' })).toBe(false);
    expect(isTokenCard({ id: 'b', name: 'Emblem', lang: 'en', layout: 'emblem', set: 'tmh3', set_name: 'x', collector_number: '2', type_line: 'Emblem — Jace' })).toBe(false);
  });
});
