# YoLink

Cette intégration amène dans Gladys les appareils **YoLink** (YoSmart) reliés à
un hub YoLink, par l'**API officielle YoLink Open API v2** : le même compte que
l'application YoLink, sans bricolage. Non officielle, sans lien avec YoSmart.

> **Version de développement (0.1).** Écrite d'après la documentation
> officielle (doc.yosmart.com) et la bibliothèque officielle Python
> `yolink-api` de YoSmart, testée avec des réponses simulées, pas encore avec
> de vrais appareils. Vos retours sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

Un appareil Gladys par appareil YoLink pris en charge :

| Appareil YoLink                                        | Dans Gladys                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Capteur de porte (DoorSensor)                          | ouverture (ouvert/fermé), batterie %                             |
| Détecteur de mouvement (MotionSensor)                  | mouvement, batterie %                                            |
| Détecteur de fuite (LeakSensor)                        | fuite d'eau, batterie %                                          |
| Capteur de température et d'humidité (THSensor)        | température °C, humidité % (sauf modèles sans sonde), batterie % |
| Capteur de vibration (VibrationSensor)                 | vibration, batterie %                                            |
| Prise, interrupteur (Outlet, Switch)                   | marche/arrêt (commandable), puissance W (prises Energy)          |
| Multiprise (MultiOutlet)                               | chaque prise en marche/arrêt (commandable)                       |
| Vanne d'eau (Manipulator, LeakStop, FlowSmart Control) | vanne ouverte/fermée (commandable), batterie %                   |
| Serrure (Lock M1, Lock M2)                             | verrouillée (commandable), batterie %                            |
| Sirène (Siren)                                         | sirène en marche/arrêt (commandable), batterie %                 |
| Porte de garage (GarageDoor, Finger)                   | commande de volet ouvrir/fermer, état d'après son capteur        |

Les hubs, télécommandes, thermostats, arrosages et autres types ne sont pas
encore pris en charge : le bouton **Tester la connexion** indique combien
d'appareils sont ignorés.

## Installation

1. Dans l'application YoLink : **Compte** > **Paramètres avancés** >
   **Identifiants d'accès personnels** (Personal Access Credentials), puis
   **+** pour en créer un. Notez son **UAID** et sa **clé secrète**.
2. Installez l'intégration depuis le store de Gladys.
3. Dans l'onglet **Configuration**, saisissez l'UAID et la clé secrète, puis
   enregistrez. L'état indique « Connecté à YoLink : 12 appareils.
   Événements en direct actifs. »
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils voulus. Leurs
   valeurs arrivent dès l'ajout.

## Sécurité : commandes désactivées par défaut

Ces commandes restent refusées tant que vous ne les autorisez pas dans la
configuration :

| Option                                     | Par défaut | Désactivée : Gladys…                              |
| ------------------------------------------ | ---------- | ------------------------------------------------- |
| Autoriser le déverrouillage des serrures   | non        | peut verrouiller, jamais déverrouiller            |
| Autoriser l'ouverture des portes de garage | non        | peut fermer une porte que son capteur dit ouverte |
| Autoriser l'ouverture des vannes d'eau     | non        | n'ouvre jamais une vanne                          |
| Autoriser la fermeture des vannes d'eau    | non        | ne ferme jamais une vanne                         |
| Autoriser l'arrêt des sirènes              | oui        | peut déclencher une sirène, jamais l'arrêter      |

Une commande refusée affiche un message qui renvoie à l'option. Pour couper
l'eau depuis une scène en cas de fuite, activez « Autoriser la fermeture des
vannes d'eau ». Sirène dont l'arrêt est désactivé : elle s'arrête d'elle-même
au bout de sa durée d'alarme réglée dans l'application YoLink.

La porte de garage YoLink apparaît dans Gladys comme une **commande de volet**
(ouvrir, fermer), jamais comme un interrupteur : une scène qui allume ou
éteint tout ne l'atteint donc jamais. Le contrôleur YoLink, lui, ne connaît
qu'une commande « basculer » :

- **arrêter** est refusé : le contrôleur ne sait pas arrêter la porte, et un
  basculement envoyé à la place pourrait l'inverser ;
- juste avant de basculer, l'intégration relit le capteur de porte associé ;
  s'il n'existe pas, est hors ligne ou ne donne pas d'état, la commande est
  refusée (basculer pourrait faire l'inverse) ;
- Gladys attend 5 secondes la réponse d'une commande : une commande de garage
  qui n'est pas prête à partir 3,5 secondes après son arrivée (capteur lent,
  autre commande du même garage en cours) est refusée et rien n'est envoyé ;
- les commandes d'un même garage passent une par une ; après un basculement,
  toute nouvelle commande de ce garage est refusée avec le message « commande
  ignorée » pendant 60 secondes ou jusqu'à ce que le capteur signale un état
  différent de celui d'avant le basculement (un capteur hors ligne ne lève pas
  ce blocage) : un deuxième « fermer » envoyé pendant que la porte bouge la
  rouvrirait ;
- **limite** : une porte déjà en mouvement par un autre moyen (télécommande,
  bouton mural, application YoLink) peut être inversée par un « fermer » de
  Gladys, car l'API YoLink ne permet pas de savoir qu'elle bouge : le capteur
  ne dit qu'« ouverte » ou « fermée » ;
- **limite** : un capteur qui se trompe (mal placé, aimant décalé, état figé)
  fait faire à la bascule l'inverse de la commande, y compris un « fermer »
  qui **ouvre** la porte, même avec l'ouverture désactivée. C'est
  indétectable : le cloud ne renvoie que le dernier état signalé par le
  capteur. Vérifiez que le capteur suit bien la porte avant d'automatiser.

## Comment les valeurs arrivent

- **En direct** (option « Événements en direct », activée par défaut) :
  l'intégration s'abonne aux événements MQTT de votre maison YoLink. Une porte
  qui s'ouvre, un mouvement ou une fuite arrivent en une ou deux secondes.
  Chaque alerte est enregistrée, même deux alertes de suite. Voir
  « Confidentialité » avant de la laisser activée.
- **Rafraîchissement complet** : au démarrage puis toutes les 30 minutes
  (réglable de 10 à 1440), l'intégration relit en HTTPS la liste des appareils
  et l'état de chacun (une requête par appareil, espacées d'une demi-seconde).
  Sans les événements en direct, c'est la seule source des valeurs.
- Les appareils de la zone Europe (modèles « -EC ») sont lus sur le cloud
  européen de YoLink, les autres sur le cloud américain, comme le fait
  l'application.
- Multiprise YS6801 : le canal 0 correspond aux ports USB, les canaux 1 à 4
  aux prises 1 à 4.

## Limites d'usage

- YoLink n'autorise par identifiant d'accès que 5 connexions MQTT ouvertes et
  10 nouvelles connexions par 5 minutes : l'intégration en utilise une par
  cloud (au plus deux) et n'en ouvre jamais plus de 8 par 5 minutes. N'utilisez
  pas le même identifiant d'accès dans plusieurs logiciels à la fois (Home
  Assistant, Gladys…) : créez-en un par logiciel.
- Si YoLink répond « limite atteinte », l'intégration fait une pause de 15
  minutes, pendant laquelle ni la Découverte ni le bouton de test ne relisent
  YoLink ; en cas d'erreur réseau, elle réessaie après 1, 2, 5, 10 puis 15
  minutes.
- Gladys accepte 300 états par minute : au-delà, les valeurs attendent la
  minute suivante.

## Options

| Option                                       | Défaut   | Rôle                                                 |
| -------------------------------------------- | -------- | ---------------------------------------------------- |
| UAID, clé secrète                            | —        | l'identifiant d'accès créé dans l'application YoLink |
| Autoriser le déverrouillage, garage, vannes  | non      | voir « Sécurité »                                    |
| Autoriser l'arrêt des sirènes                | oui      | voir « Sécurité »                                    |
| Événements en direct (MQTT non chiffré)      | oui      | voir « Confidentialité »                             |
| Intervalle de rafraîchissement complet (min) | 30       | fréquence de relecture complète                      |
| Langue des noms des fonctionnalités          | Français | noms des fonctionnalités des appareils ajoutés       |

## Dépannage

- **« YoLink a refusé l'UAID ou la clé secrète »** : vérifiez-les (l'identifiant
  a peut-être été supprimé dans l'application). L'intégration attend une
  modification ou un clic sur **Tester la connexion**.
- **Badge `cloud` avec un point orange « Événements en direct interrompus »** :
  la connexion MQTT est coupée, l'intégration se reconnecte (30 s, puis
  jusqu'à 5 min). Les valeurs arrivent au plus tard au rafraîchissement
  suivant.
- **Badge `injoignable` avec un point orange** : YoLink signale l'appareil
  hors ligne (piles, portée du hub).
- **« Le LeakStop n'a pas répondu »** : en mode économie d'énergie (classe A),
  il n'écoute que de temps en temps ; réessayez ou changez son mode dans
  l'application YoLink.
- **Un appareil n'apparaît pas** : son type n'est pas encore pris en charge ;
  ouvrez un ticket sur le dépôt GitHub en indiquant son modèle. Le compteur
  FlowSmart Meter (YS5007), sans vanne, est ignoré.

## Confidentialité

L'UAID et la clé secrète sont gardés par Gladys dans sa base (la clé est
masquée dans l'interface, jamais réaffichée ; Gladys ne la chiffre pas, elle
figure donc aussi dans ses sauvegardes). La clé n'est envoyée qu'à
`api.yosmart.com/open/yolink/token` (HTTPS) pour obtenir un jeton d'accès, qui
reste en mémoire (rien n'est écrit dans `/data`). Toutes les autres requêtes
HTTP (liste des appareils, états, commandes) partent vers YoLink en HTTPS.

### Événements en direct : ce qui circule en clair

L'option « Événements en direct » est **activée par défaut**. C'est la seule
partie de l'intégration qui n'est **pas chiffrée** : le broker MQTT de YoLink
n'offre que du TCP simple sur le port 8003 (le port 8004 est du WebSocket, lui
aussi sans TLS ; une connexion TLS est refusée sur les deux).

- **Entre quoi et quoi** : la machine qui fait tourner Gladys (le conteneur de
  l'intégration) et le broker MQTT de YoLink, `mqtt.api.yosmart.com:8003`
  (cloud américain) et, si vous avez des appareils européens,
  `api-eu.yosmart.com:8003` (cloud européen), en passant par votre réseau
  local, votre fournisseur d'accès et Internet.
- **Ce qui circule en clair** :
  - le **jeton d'accès** (envoyé comme nom d'utilisateur MQTT à chaque
    connexion). Il est valable environ 2 heures : qui le lit peut, pendant ce
    temps, **commander tous vos appareils YoLink, y compris déverrouiller les
    serrures et ouvrir le garage**, quelles que soient les options de Gladys ;
  - l'**identifiant de votre maison** YoLink (dans le sujet MQTT) et
    l'**identifiant de chaque appareil** ;
  - **tous les événements de vos appareils** : portes qui s'ouvrent et se
    ferment, mouvements, fuites, températures et humidité, états des serrures,
    vannes, sirènes et prises, batteries, réponses aux commandes. Ils disent
    quand quelqu'un est à la maison.
- **Événements falsifiés** : sans TLS, quelqu'un sur ce chemin peut aussi
  injecter de faux événements (porte qui s'ouvre, fuite, mouvement) que
  Gladys prend pour vrais, et donc déclencher vos scènes.
- **Aucune variante chiffrée** : YoSmart n'offre aucun port TLS (seulement
  8003 en TCP et 8004 en WebSocket, tous deux en clair) ; désactiver l'option
  est le seul moyen de l'éviter.
- **Ce qui n'y passe jamais** : l'UAID et la clé secrète, et les commandes
  (toujours envoyées en HTTPS).
- **Pour le désactiver** : dans Gladys, **Intégrations** > **YoLink** >
  **Configuration**, décochez « Événements en direct (MQTT non chiffré) » et
  enregistrez. Les connexions MQTT se ferment aussitôt et aucune n'est
  rouverte ; les valeurs n'arrivent plus qu'à chaque rafraîchissement complet,
  en HTTPS (baissez « Intervalle de rafraîchissement complet » à 10 minutes
  pour des valeurs plus fraîches). L'état indique alors « Événements en direct
  désactivés ».

YoLink est une marque de YoSmart ; cette intégration est sans lien avec
YoSmart.
