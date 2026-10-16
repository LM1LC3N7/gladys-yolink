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
  connected: (devices, live) => ({
    en: `Connected to YoLink: ${plural(devices, 'device', 'devices')}. ${live ? 'Live events on.' : 'Live events connecting…'} Open Discovery to add them.`,
    fr: `Connecté à YoLink : ${plural(devices, 'appareil', 'appareils')}. ${live ? 'Événements en direct actifs.' : 'Événements en direct en cours de connexion…'} Ouvrez Découverte pour les ajouter.`,
  }),
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
      en: 'The garage door state is unknown (no door sensor paired): closing could open it, so it needs the opening allowed in the configuration.',
      fr: "L'état de la porte de garage est inconnu (aucun capteur associé) : fermer pourrait l'ouvrir, il faut donc autoriser l'ouverture dans la configuration.",
    },
    valve: {
      en: 'Opening water valves from Gladys is turned off: allow it in the configuration of the YoLink integration.',
      fr: "L'ouverture des vannes d'eau depuis Gladys est désactivée : autorisez-la dans la configuration de l'intégration YoLink.",
    },
  },
  test: {
    cooldown: {
      en: 'Already read less than 30 seconds ago.',
      fr: 'Déjà lu il y a moins de 30 secondes.',
    },
    summary: (devices, skipped, live) => ({
      en: `${plural(devices, 'supported device', 'supported devices')}${skipped ? `, ${plural(skipped, 'other device', 'other devices')} not supported yet` : ''}. Live events: ${live ? 'on' : 'connecting'}.`,
      fr: `${plural(devices, 'appareil pris en charge', 'appareils pris en charge')}${skipped ? `, ${plural(skipped, 'autre appareil', 'autres appareils')} pas encore pris en charge` : ''}. Événements en direct : ${live ? 'actifs' : 'en cours de connexion'}.`,
    }),
  },
};
