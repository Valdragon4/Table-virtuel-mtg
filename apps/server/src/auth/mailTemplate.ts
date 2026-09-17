/**
 * Le gabarit des emails transactionnels.
 *
 * Un email n'est pas une page web, et ce fichier est écrit contre cette
 * différence plutôt qu'en l'ignorant :
 *
 *  - **Tout est en ligne.** Gmail tronque, Outlook ignore, et la plupart des
 *    clients retirent purement et simplement une feuille de style. Il n'y a
 *    donc pas une seule classe ici : chaque couleur, chaque marge est portée
 *    par l'attribut `style` de l'élément qu'elle concerne.
 *  - **La mise en page est un tableau.** Flexbox et grid ne sont pas fiables
 *    chez les clients Outlook, qui rendent avec le moteur de Word.
 *  - **Le logo est un PNG, pas notre SVG.** Gmail et Outlook suppriment les
 *    `<svg>` sans rien afficher à la place. Et comme la plupart des clients
 *    bloquent les images distantes par défaut, **le message doit se lire sans
 *    elles** : la marque est donc aussi écrite en toutes lettres à côté, et
 *    aucune information ne vit dans une image.
 *  - **Le lien est cliquable *et* recopiable.** Un `<a>` stylé en bouton pour
 *    le geste courant, et l'URL en clair en dessous — un client qui mange le
 *    bouton, ou un utilisateur qui préfère coller, ne doit pas rester bloqué.
 *
 * L'habillage reprend l'identité du site : le sol sombre de la salle, une
 * plaque de carton posée dessus, et une seule encre saturée — le violet de
 * tampon. Les polices du site sont auto-hébergées et donc inutilisables ici ;
 * on retombe sur les piles système, en gardant le Courier pour ce qui est
 * « tapé » (l'URL), comme sur le site.
 */

/** L'identité, en dur : un email ne peut pas lire nos variables CSS. */
const C = {
  floor: '#0b0e14',
  floorText: '#e9e5db',
  floorDim: '#a09b8d',
  paper: '#e9e3d4',
  paperEdge: '#b9b09a',
  ink: '#16141b',
  inkSoft: '#5c5647',
  stamp: '#7c3aed',
  stampPale: '#bda6ff',
} as const;

const SANS = "Archivo, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'Courier New', Courier, monospace";

export interface Plate {
  /** Ce qui s'affiche dans la liste des messages, avant ouverture. */
  preheader: string;
  title: string;
  /** Les paragraphes du corps, en texte simple. */
  body: string[];
  action: { label: string; url: string };
  /** La ligne de bas de plaque : durée de validité, quoi faire si ce n'est pas vous. */
  footnote: string;
  publicUrl: string;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Rend la plaque complète.
 *
 * `publicUrl` sert deux fois : à retrouver le logo, et à faire de la marque un
 * lien vers le site — c'est ce qu'on attend d'un en-tête d'email.
 */
export function renderMail(plate: Plate): string {
  const logo = `${plate.publicUrl}/icon-192.png`;
  const url = escape(plate.action.url);

  const paragraphs = plate.body
    .map(
      (line) =>
        `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.ink};">${escape(line)}</p>`,
    )
    .join('');

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escape(plate.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.floor};">
<!-- Le préen-tête : la ligne que montre la liste des messages. Masquée dans le
     corps, mais lue par le client — sans elle, il affiche le début du HTML. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escape(plate.preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.floor};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

        <!-- La marque. Le PNG peut être bloqué : le nom écrit à côté porte
             l'identification à lui seul. -->
        <tr>
          <td style="padding:0 4px 20px;">
            <a href="${escape(plate.publicUrl)}" style="text-decoration:none;">
              <img src="${escape(logo)}" width="40" height="40" alt=""
                   style="vertical-align:middle;border:0;border-radius:9px;display:inline-block;">
              <span style="vertical-align:middle;padding-left:10px;font-family:${SANS};font-size:15px;font-weight:600;letter-spacing:0.02em;color:${C.floorText};">Table virtuelle <span style="color:${C.stampPale};">MTG</span></span>
            </a>
          </td>
        </tr>

        <!-- La plaque de carton. -->
        <tr>
          <td style="background-color:${C.paper};border:1px solid ${C.paperEdge};border-radius:3px;padding:30px 28px;">
            <h1 style="margin:0 0 18px;font-family:${SANS};font-size:22px;line-height:1.25;font-weight:700;color:${C.ink};">${escape(plate.title)}</h1>
            ${paragraphs}

            <!-- Le bouton. Un tableau plutôt qu'un simple lien à padding :
                 Outlook ignore le remplissage d'un <a>, et le bouton s'y
                 réduirait à du texte souligné. -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 16px;">
              <tr>
                <td align="center" bgcolor="${C.stamp}" style="border-radius:3px;">
                  <a href="${url}" style="display:inline-block;padding:13px 26px;font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:3px;">${escape(plate.action.label)}</a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.inkSoft};">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :</p>
            <p style="margin:0;font-family:${MONO};font-size:12px;line-height:1.5;word-break:break-all;">
              <a href="${url}" style="color:${C.stamp};text-decoration:underline;">${url}</a>
            </p>

            <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${C.paperEdge};font-family:${SANS};font-size:12px;line-height:1.6;color:${C.inkSoft};">${escape(plate.footnote)}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 4px 0;font-family:${SANS};font-size:11px;line-height:1.6;color:${C.floorDim};">
            Message automatique — cette adresse ne reçoit pas de réponse.<br>
            Magic: The Gathering est une marque de Wizards of the Coast. Ce service
            n'est ni affilié ni soutenu par elle.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
