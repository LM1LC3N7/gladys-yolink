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
| Porte de garage (GarageDoor, Finger)                   | porte ouverte/fermée d'après son capteur (commandable)           |

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

La porte de garage YoLink ne connaît qu'une commande « basculer » :

- juste avant de basculer, l'intégration relit le capteur de porte associé ;
  s'il n'existe pas, est hors ligne ou ne donne pas d'état, la commande est
  refusée (basculer pourrait faire l'inverse) ;
- après un basculement, toute nouvelle commande de ce garage est ignorée
  pendant 60 secondes ou jusqu'à ce que le capteur signale un changement : un
  deuxième « fermer » envoyé pendant que la porte bouge la rouvrirait.

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

L'UAID et la clé secrète sont stockés par Gladys comme secrets (la clé n'est
jamais renvoyée au navigateur). La clé n'est envoyée qu'à
`api.yosmart.com/open/yolink/token` (HTTPS) pour obtenir un jeton d'accès, qui
reste en mémoire (rien n'est écrit dans `/data`).

**Les événements en direct ne sont pas chiffrés.** Ils passent par le broker
MQTT de YoLink sur le port 8003, sans TLS : c'est le seul mode documenté par
YoLink (le port 8004 est du WebSocket, lui aussi sans TLS). Le jeton d'accès y
circule **en clair** comme nom d'utilisateur. Quiconque observe votre réseau
(ou le chemin jusqu'à YoLink) peut le lire et, pendant environ 2 heures (sa
durée de validité), **commander tous vos appareils YoLink, y compris
déverrouiller les serrures et ouvrir le garage**, quelles que soient les
options de Gladys. La clé secrète, elle, n'y passe jamais. Si ce risque n'est
pas acceptable, désactivez l'option « Événements en direct » : il ne reste
alors que les lectures HTTPS, à chaque rafraîchissement complet.

YoLink est une marque de YoSmart ; cette intégration est sans lien avec
YoSmart.
