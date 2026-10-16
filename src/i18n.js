// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature
// names, command refusals), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts?.[language] ?? texts?.en ?? '';

/** Device names when YoLink has none. */
export const TYPE_NAMES = {
  door: { en: 'Door sensor', fr: 'Capteur de porte' },
  motion: { en: 'Motion sensor', fr: 'Détecteur de mouvement' },
  leak: { en: 'Leak sensor', fr: 'Détecteur de fuite' },
  climate: { en: 'Temperature sensor', fr: 'Capteur de température' },
  vibration: { en: 'Vibration sensor', fr: 'Capteur de vibration' },
  switch: { en: 'Switch', fr: 'Interrupteur' },
  'multi-outlet': { en: 'Power strip', fr: 'Multiprise' },
  valve: { en: 'Water valve', fr: "Vanne d'eau" },
  lock: { en: 'Lock', fr: 'Serrure' },
  siren: { en: 'Siren', fr: 'Sirène' },
  garage: { en: 'Garage door', fr: 'Porte de garage' },
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  opening: { en: 'Door', fr: 'Ouverture' },
  motion: { en: 'Motion', fr: 'Mouvement' },
  leak: { en: 'Water leak', fr: "Fuite d'eau" },
  vibration: { en: 'Vibration', fr: 'Vibration' },
  temperature: { en: 'Temperature', fr: 'Température' },
  humidity: { en: 'Humidity', fr: 'Humidité' },
  battery: { en: 'Battery', fr: 'Batterie' },
  switch: { en: 'Power', fr: 'Alimentation' },
  socket: { en: 'Socket', fr: 'Prise' },
  usb: { en: 'USB ports', fr: 'Ports USB' },
  power: { en: 'Power draw', fr: 'Puissance' },
  valve: { en: 'Valve open', fr: 'Vanne ouverte' },
  lock: { en: 'Locked', fr: 'Verrouillée' },
  siren: { en: 'Siren', fr: 'Sirène' },
  garage: { en: 'Garage door open', fr: 'Porte de garage ouverte' },
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

export const T = {
  noCredentials: {
    en: 'Enter the UAID and the secret key of a User Access Credential made in the YoLink app (Account > Advanced Settings > Personal Access Credentials).',
    fr: "Saisissez l'UAID et la clé secrète d'un identifiant d'accès créé dans l'application YoLink (Compte > Paramètres avancés > Identifiants d'accès personnels).",
  },
  connecting: {
    en: 'Connecting to YoLink…',
    fr: 'Connexion à YoLink…',
  },
  /** `live`: true, false (connecting) or 'off' (turned off in the configuration). */
  connected: (devices, live) => {
    const en =
      live === 'off'
        ? 'Live events off: values are read every refresh interval.'
        : live
          ? 'Live events on.'
          : 'Live events connecting…';
    const fr =
      live === 'off'
        ? 'Événements en direct désactivés : les valeurs sont lues à chaque rafraîchissement.'
        : live
          ? 'Événements en direct actifs.'
          : 'Événements en direct en cours de connexion…';
    return {
      en: `Connected to YoLink: ${plural(devices, 'device', 'devices')}. ${en} Open Discovery to add them.`,
      fr: `Connecté à YoLink : ${plural(devices, 'appareil', 'appareils')}. ${fr} Ouvrez Découverte pour les ajouter.`,
    };
  },
  refused: {
    en: 'YoLink refused the UAID or the secret key: check them in the configuration (the integration waits for a change).',
    fr: "YoLink a refusé l'UAID ou la clé secrète : vérifiez-les dans la configuration (l'intégration attend une modification).",
  },
  unreachable: (reason, wait) => ({
    en: `YoLink cannot be reached (${reason}). Next try in ${wait.en}.`,
    fr: `YoLink est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
  }),
  rateLimited: (wait) => ({
    en: `YoLink says its request limit is reached: pausing for ${wait.en}.`,
    fr: `YoLink indique que sa limite de requêtes est atteinte : pause de ${wait.fr}.`,
  }),
  offline: {
    en: 'YoLink reports this device offline.',
    fr: 'YoLink signale cet appareil hors ligne.',
  },
  liveDown: {
    en: 'Live events paused: values arrive at the next full refresh.',
    fr: 'Événements en direct interrompus : les valeurs arrivent au prochain rafraîchissement complet.',
  },
  denied: {
    unlock: {
      en: 'Unlocking from Gladys is turned off: allow it in the configuration of the YoLink integration.',
      fr: "Le déverrouillage depuis Gladys est désactivé : autorisez-le dans la configuration de l'intégration YoLink.",
    },
    garage: {
      en: 'Opening the garage door from Gladys is turned off: allow it in the configuration of the YoLink integration.',
      fr: "L'ouverture de la porte de garage depuis Gladys est désactivée : autorisez-la dans la configuration de l'intégration YoLink.",
    },
    garageUnknown: {
      en: 'The garage door state is unknown (no door sensor paired, or it is offline or did not answer): a toggle could do the opposite, so the command is refused.',
      fr: "L'état de la porte de garage est inconnu (aucun capteur associé, ou il est hors ligne ou n'a pas répondu) : basculer pourrait faire l'inverse, la commande est donc refusée.",
    },
    garageMoving: {
      en: 'The garage door was just toggled and its sensor has not reported a change yet: command ignored (try again in a minute).',
      fr: "La porte de garage vient d'être basculée et son capteur n'a pas encore signalé de changement : commande ignorée (réessayez dans une minute).",
    },
    valve: {
      en: 'Opening water valves from Gladys is turned off: allow it in the configuration of the YoLink integration.',
      fr: "L'ouverture des vannes d'eau depuis Gladys est désactivée : autorisez-la dans la configuration de l'intégration YoLink.",
    },
    valveClose: {
      en: 'Closing water valves from Gladys is turned off: allow it in the configuration of the YoLink integration.',
      fr: "La fermeture des vannes d'eau depuis Gladys est désactivée : autorisez-la dans la configuration de l'intégration YoLink.",
    },
    sirenStop: {
      en: 'Stopping sirens from Gladys is turned off: allow it in the configuration of the YoLink integration.',
      fr: "L'arrêt des sirènes depuis Gladys est désactivé : autorisez-le dans la configuration de l'intégration YoLink.",
    },
  },
  leakStopAsleep: {
    en: 'The LeakStop did not answer. In its power-saving (class A) mode it only listens from time to time: try again in a few minutes, or change its mode in the YoLink app.',
    fr: "Le LeakStop n'a pas répondu. En mode économie d'énergie (classe A), il n'écoute que de temps en temps : réessayez dans quelques minutes, ou changez son mode dans l'application YoLink.",
  },
  test: {
    cooldown: {
      en: 'Already read less than 30 seconds ago.',
      fr: 'Déjà lu il y a moins de 30 secondes.',
    },
    summary: (devices, skipped, live) => ({
      en: `${plural(devices, 'supported device', 'supported devices')}${skipped ? `, ${plural(skipped, 'other device', 'other devices')} not supported yet` : ''}. Live events: ${live === 'off' ? 'off' : live ? 'on' : 'connecting'}.`,
      fr: `${plural(devices, 'appareil pris en charge', 'appareils pris en charge')}${skipped ? `, ${plural(skipped, 'autre appareil', 'autres appareils')} pas encore pris en charge` : ''}. Événements en direct : ${live === 'off' ? 'désactivés' : live ? 'actifs' : 'en cours de connexion'}.`,
    }),
  },
};
