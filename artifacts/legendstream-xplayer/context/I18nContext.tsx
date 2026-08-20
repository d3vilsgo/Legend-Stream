import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import React, { createContext, ReactNode, useContext, useMemo, useState } from "react";

export type AppLanguage = "tr" | "en" | "de" | "fr" | "es" | "it" | "ru";

type Dictionary = Record<string, string>;

type I18nValue = {
  language: AppLanguage;
  languages: Array<{ code: AppLanguage; label: string }>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const STORAGE_KEY = "@legendstream/language-v1";

const dictionaries: Record<AppLanguage, Dictionary> = {
  tr: {
    home: "Ana Sayfa", liveTv: "Canlı TV", movies: "Filmler", series: "Diziler", history: "Geçmiş", settings: "Ayarlar",
    savedConnections: "Kayıtlı bağlantılar", savedAccounts: "Kayıtlı hesaplar", accountsRemembered: "Hesaplar bu cihazda hatırlanır.",
    chooseAccount: "Kayıtlı bir IPTV hesabı seçin veya yeni bir hesap ekleyin.", addAccount: "Hesap ekle", addNewAccount: "Yeni hesap ekle",
    opening: "Açılıyor…", activeConnection: "Aktif bağlantı", refreshLive: "Canlı TV'yi yenile", refreshingLive: "Canlı TV yenileniyor…",
    tapToLoad: "Yüklemek için dokun", channels: "{count} kanal", titles: "{count} içerik", seriesCount: "{count} dizi",
    search: "Ara", all: "Tümü", loadMore: "Daha fazla yükle", loading: "Yükleniyor…", refresh: "Yenile",
    editSource: "Kaynağı düzenle", disconnect: "Bağlantıyı kes", remove: "Sil", active: "Aktif", language: "Dil",
    addIptvSource: "IPTV kaynağı ekle", editIptvSource: "IPTV kaynağını düzenle", sourceName: "Kaynak adı",
    serverUrl: "Sunucu / oynatma listesi URL", username: "Kullanıcı adı", password: "Şifre", macAddress: "MAC adresi", epgOptional: "EPG URL (isteğe bağlı)",
    connecting: "Bağlanıyor…", addConnect: "Ekle ve bağlan", saveConnect: "Kaydet ve bağlan", cancel: "İptal",
    invalidUrl: "http:// veya https:// ile başlayan tam bir URL girin.", xtreamCredentials: "Xtream için kullanıcı adı ve şifre gerekir.",
    recentlyWatched: "Son izlenenler", favorites: "Favoriler", nothingYet: "Henüz içerik yok.", season: "Sezon", episode: "Bölüm",
    noEpisodes: "Bölüm listesi gelmedi.", loadingMovies: "Filmler yükleniyor…", loadingSeries: "Diziler yükleniyor…", loadingEpisodes: "Bölümler yükleniyor…",
    audio: "Ses", subtitles: "Altyazı", off: "Kapalı", screen: "Ekran", fit: "Sığdır", crop: "Kırp", stretch: "Esnet",
    back: "Geri", download: "İndir", downloading: "İndiriliyor…", downloaded: "İndirildi", downloadFailed: "İndirme başarısız",
    noTracks: "Seçilebilir parça yok", playbackFailed: "Oynatma başarısız", loadingVideo: "Video yükleniyor…",
    m3uNoGroups: "Bu M3U listesi kategori bilgisi içermiyor.", providerOrder: "Yayıncı sırası",
  },
  en: {
    home: "Home", liveTv: "Live TV", movies: "Movies", series: "Series", history: "History", settings: "Settings",
    savedConnections: "Saved connections", savedAccounts: "Saved accounts", accountsRemembered: "Accounts are remembered on this device.",
    chooseAccount: "Choose a remembered IPTV account or add another one.", addAccount: "Add account", addNewAccount: "Add new account",
    opening: "Opening…", activeConnection: "Active connection", refreshLive: "Refresh live", refreshingLive: "Refreshing live…",
    tapToLoad: "Tap to load", channels: "{count} channels", titles: "{count} titles", seriesCount: "{count} series",
    search: "Search", all: "All", loadMore: "Load more", loading: "Loading…", refresh: "Refresh",
    editSource: "Edit source", disconnect: "Disconnect", remove: "Remove", active: "Active", language: "Language",
    addIptvSource: "Add IPTV source", editIptvSource: "Edit IPTV source", sourceName: "Source name",
    serverUrl: "Server / playlist URL", username: "Username", password: "Password", macAddress: "MAC address", epgOptional: "EPG URL (optional)",
    connecting: "Connecting…", addConnect: "Add & connect", saveConnect: "Save & connect", cancel: "Cancel",
    invalidUrl: "Enter a full URL beginning with http:// or https://", xtreamCredentials: "Xtream requires username and password.",
    recentlyWatched: "Recently watched", favorites: "Favorites", nothingYet: "Nothing here yet.", season: "Season", episode: "Episode",
    noEpisodes: "No episode list was returned.", loadingMovies: "Loading Movies…", loadingSeries: "Loading Series…", loadingEpisodes: "Loading episodes…",
    audio: "Audio", subtitles: "Subtitles", off: "Off", screen: "Screen", fit: "Fit", crop: "Crop", stretch: "Stretch",
    back: "Back", download: "Download", downloading: "Downloading…", downloaded: "Downloaded", downloadFailed: "Download failed",
    noTracks: "No selectable tracks", playbackFailed: "Playback failed", loadingVideo: "Loading video…",
    m3uNoGroups: "This M3U playlist does not contain category metadata.", providerOrder: "Provider order",
  },
  de: {
    home: "Start", liveTv: "Live-TV", movies: "Filme", series: "Serien", history: "Verlauf", settings: "Einstellungen", savedConnections: "Gespeicherte Verbindungen", savedAccounts: "Gespeicherte Konten", accountsRemembered: "Konten werden auf diesem Gerät gespeichert.", chooseAccount: "Gespeichertes IPTV-Konto wählen oder neues hinzufügen.", addAccount: "Konto hinzufügen", addNewAccount: "Neues Konto", opening: "Wird geöffnet…", activeConnection: "Aktive Verbindung", refreshLive: "Live-TV aktualisieren", refreshingLive: "Live-TV wird aktualisiert…", tapToLoad: "Zum Laden tippen", channels: "{count} Sender", titles: "{count} Titel", seriesCount: "{count} Serien", search: "Suchen", all: "Alle", loadMore: "Mehr laden", loading: "Laden…", refresh: "Aktualisieren", editSource: "Quelle bearbeiten", disconnect: "Trennen", remove: "Entfernen", active: "Aktiv", language: "Sprache", addIptvSource: "IPTV-Quelle hinzufügen", editIptvSource: "IPTV-Quelle bearbeiten", sourceName: "Quellenname", serverUrl: "Server-/Playlist-URL", username: "Benutzername", password: "Passwort", macAddress: "MAC-Adresse", epgOptional: "EPG-URL (optional)", connecting: "Verbinden…", addConnect: "Hinzufügen & verbinden", saveConnect: "Speichern & verbinden", cancel: "Abbrechen", invalidUrl: "Vollständige URL mit http:// oder https:// eingeben.", xtreamCredentials: "Xtream benötigt Benutzername und Passwort.", recentlyWatched: "Zuletzt angesehen", favorites: "Favoriten", nothingYet: "Noch nichts vorhanden.", season: "Staffel", episode: "Folge", noEpisodes: "Keine Episodenliste erhalten.", loadingMovies: "Filme werden geladen…", loadingSeries: "Serien werden geladen…", loadingEpisodes: "Folgen werden geladen…", audio: "Audio", subtitles: "Untertitel", off: "Aus", screen: "Bild", fit: "Einpassen", crop: "Zuschneiden", stretch: "Strecken", back: "Zurück", download: "Herunterladen", downloading: "Wird geladen…", downloaded: "Heruntergeladen", downloadFailed: "Download fehlgeschlagen", noTracks: "Keine auswählbaren Spuren", playbackFailed: "Wiedergabe fehlgeschlagen", loadingVideo: "Video wird geladen…", m3uNoGroups: "Diese M3U-Liste enthält keine Kategorien.", providerOrder: "Anbieter-Reihenfolge",
  },
  fr: {
    home: "Accueil", liveTv: "TV en direct", movies: "Films", series: "Séries", history: "Historique", settings: "Réglages", savedConnections: "Connexions enregistrées", savedAccounts: "Comptes enregistrés", accountsRemembered: "Les comptes sont mémorisés sur cet appareil.", chooseAccount: "Choisissez un compte IPTV ou ajoutez-en un.", addAccount: "Ajouter un compte", addNewAccount: "Nouveau compte", opening: "Ouverture…", activeConnection: "Connexion active", refreshLive: "Actualiser le direct", refreshingLive: "Actualisation…", tapToLoad: "Touchez pour charger", channels: "{count} chaînes", titles: "{count} titres", seriesCount: "{count} séries", search: "Rechercher", all: "Tous", loadMore: "Charger plus", loading: "Chargement…", refresh: "Actualiser", editSource: "Modifier la source", disconnect: "Déconnecter", remove: "Supprimer", active: "Actif", language: "Langue", addIptvSource: "Ajouter une source IPTV", editIptvSource: "Modifier la source IPTV", sourceName: "Nom de la source", serverUrl: "URL serveur / playlist", username: "Utilisateur", password: "Mot de passe", macAddress: "Adresse MAC", epgOptional: "URL EPG (optionnel)", connecting: "Connexion…", addConnect: "Ajouter et connecter", saveConnect: "Enregistrer et connecter", cancel: "Annuler", invalidUrl: "Saisissez une URL complète commençant par http:// ou https://", xtreamCredentials: "Xtream nécessite un utilisateur et un mot de passe.", recentlyWatched: "Récemment regardé", favorites: "Favoris", nothingYet: "Aucun contenu pour le moment.", season: "Saison", episode: "Épisode", noEpisodes: "Aucune liste d’épisodes reçue.", loadingMovies: "Chargement des films…", loadingSeries: "Chargement des séries…", loadingEpisodes: "Chargement des épisodes…", audio: "Audio", subtitles: "Sous-titres", off: "Désactivé", screen: "Écran", fit: "Ajuster", crop: "Recadrer", stretch: "Étirer", back: "Retour", download: "Télécharger", downloading: "Téléchargement…", downloaded: "Téléchargé", downloadFailed: "Échec du téléchargement", noTracks: "Aucune piste sélectionnable", playbackFailed: "Échec de lecture", loadingVideo: "Chargement de la vidéo…", m3uNoGroups: "Cette playlist M3U ne contient pas de catégories.", providerOrder: "Ordre du fournisseur",
  },
  es: {
    home: "Inicio", liveTv: "TV en vivo", movies: "Películas", series: "Series", history: "Historial", settings: "Ajustes", savedConnections: "Conexiones guardadas", savedAccounts: "Cuentas guardadas", accountsRemembered: "Las cuentas se recuerdan en este dispositivo.", chooseAccount: "Elige una cuenta IPTV guardada o añade otra.", addAccount: "Añadir cuenta", addNewAccount: "Nueva cuenta", opening: "Abriendo…", activeConnection: "Conexión activa", refreshLive: "Actualizar TV", refreshingLive: "Actualizando…", tapToLoad: "Toca para cargar", channels: "{count} canales", titles: "{count} títulos", seriesCount: "{count} series", search: "Buscar", all: "Todos", loadMore: "Cargar más", loading: "Cargando…", refresh: "Actualizar", editSource: "Editar fuente", disconnect: "Desconectar", remove: "Eliminar", active: "Activo", language: "Idioma", addIptvSource: "Añadir fuente IPTV", editIptvSource: "Editar fuente IPTV", sourceName: "Nombre de fuente", serverUrl: "URL servidor / lista", username: "Usuario", password: "Contraseña", macAddress: "Dirección MAC", epgOptional: "URL EPG (opcional)", connecting: "Conectando…", addConnect: "Añadir y conectar", saveConnect: "Guardar y conectar", cancel: "Cancelar", invalidUrl: "Introduce una URL completa que empiece por http:// o https://", xtreamCredentials: "Xtream requiere usuario y contraseña.", recentlyWatched: "Vistos recientemente", favorites: "Favoritos", nothingYet: "Aún no hay contenido.", season: "Temporada", episode: "Episodio", noEpisodes: "No se recibió lista de episodios.", loadingMovies: "Cargando películas…", loadingSeries: "Cargando series…", loadingEpisodes: "Cargando episodios…", audio: "Audio", subtitles: "Subtítulos", off: "Desactivados", screen: "Pantalla", fit: "Ajustar", crop: "Recortar", stretch: "Estirar", back: "Volver", download: "Descargar", downloading: "Descargando…", downloaded: "Descargado", downloadFailed: "Error de descarga", noTracks: "No hay pistas seleccionables", playbackFailed: "Error de reproducción", loadingVideo: "Cargando vídeo…", m3uNoGroups: "Esta lista M3U no contiene categorías.", providerOrder: "Orden del proveedor",
  },
  it: {
    home: "Home", liveTv: "TV Live", movies: "Film", series: "Serie", history: "Cronologia", settings: "Impostazioni", savedConnections: "Connessioni salvate", savedAccounts: "Account salvati", accountsRemembered: "Gli account vengono ricordati su questo dispositivo.", chooseAccount: "Scegli un account IPTV salvato o aggiungine uno.", addAccount: "Aggiungi account", addNewAccount: "Nuovo account", opening: "Apertura…", activeConnection: "Connessione attiva", refreshLive: "Aggiorna Live", refreshingLive: "Aggiornamento…", tapToLoad: "Tocca per caricare", channels: "{count} canali", titles: "{count} titoli", seriesCount: "{count} serie", search: "Cerca", all: "Tutti", loadMore: "Carica altro", loading: "Caricamento…", refresh: "Aggiorna", editSource: "Modifica sorgente", disconnect: "Disconnetti", remove: "Rimuovi", active: "Attivo", language: "Lingua", addIptvSource: "Aggiungi sorgente IPTV", editIptvSource: "Modifica sorgente IPTV", sourceName: "Nome sorgente", serverUrl: "URL server / playlist", username: "Nome utente", password: "Password", macAddress: "Indirizzo MAC", epgOptional: "URL EPG (opzionale)", connecting: "Connessione…", addConnect: "Aggiungi e connetti", saveConnect: "Salva e connetti", cancel: "Annulla", invalidUrl: "Inserisci un URL completo che inizi con http:// o https://", xtreamCredentials: "Xtream richiede nome utente e password.", recentlyWatched: "Visti di recente", favorites: "Preferiti", nothingYet: "Ancora nessun contenuto.", season: "Stagione", episode: "Episodio", noEpisodes: "Nessun elenco episodi ricevuto.", loadingMovies: "Caricamento film…", loadingSeries: "Caricamento serie…", loadingEpisodes: "Caricamento episodi…", audio: "Audio", subtitles: "Sottotitoli", off: "Off", screen: "Schermo", fit: "Adatta", crop: "Ritaglia", stretch: "Allunga", back: "Indietro", download: "Scarica", downloading: "Download…", downloaded: "Scaricato", downloadFailed: "Download non riuscito", noTracks: "Nessuna traccia selezionabile", playbackFailed: "Riproduzione non riuscita", loadingVideo: "Caricamento video…", m3uNoGroups: "Questa playlist M3U non contiene categorie.", providerOrder: "Ordine provider",
  },
  ru: {
    home: "Главная", liveTv: "Прямой эфир", movies: "Фильмы", series: "Сериалы", history: "История", settings: "Настройки", savedConnections: "Сохранённые подключения", savedAccounts: "Сохранённые аккаунты", accountsRemembered: "Аккаунты сохраняются на этом устройстве.", chooseAccount: "Выберите сохранённый IPTV-аккаунт или добавьте новый.", addAccount: "Добавить аккаунт", addNewAccount: "Новый аккаунт", opening: "Открытие…", activeConnection: "Активное подключение", refreshLive: "Обновить эфир", refreshingLive: "Обновление…", tapToLoad: "Нажмите для загрузки", channels: "{count} каналов", titles: "{count} видео", seriesCount: "{count} сериалов", search: "Поиск", all: "Все", loadMore: "Загрузить ещё", loading: "Загрузка…", refresh: "Обновить", editSource: "Изменить источник", disconnect: "Отключиться", remove: "Удалить", active: "Активен", language: "Язык", addIptvSource: "Добавить IPTV-источник", editIptvSource: "Изменить IPTV-источник", sourceName: "Имя источника", serverUrl: "URL сервера / плейлиста", username: "Логин", password: "Пароль", macAddress: "MAC-адрес", epgOptional: "EPG URL (необязательно)", connecting: "Подключение…", addConnect: "Добавить и подключить", saveConnect: "Сохранить и подключить", cancel: "Отмена", invalidUrl: "Введите полный URL, начинающийся с http:// или https://", xtreamCredentials: "Для Xtream нужны логин и пароль.", recentlyWatched: "Недавно просмотрено", favorites: "Избранное", nothingYet: "Пока пусто.", season: "Сезон", episode: "Серия", noEpisodes: "Список серий не получен.", loadingMovies: "Загрузка фильмов…", loadingSeries: "Загрузка сериалов…", loadingEpisodes: "Загрузка серий…", audio: "Аудио", subtitles: "Субтитры", off: "Выкл.", screen: "Экран", fit: "Вписать", crop: "Обрезать", stretch: "Растянуть", back: "Назад", download: "Скачать", downloading: "Скачивание…", downloaded: "Скачано", downloadFailed: "Ошибка скачивания", noTracks: "Нет доступных дорожек", playbackFailed: "Ошибка воспроизведения", loadingVideo: "Загрузка видео…", m3uNoGroups: "В этом M3U-плейлисте нет категорий.", providerOrder: "Порядок провайдера",
  },
};

const labels: Array<{ code: AppLanguage; label: string }> = [
  { code: "tr", label: "Türkçe" }, { code: "en", label: "English" }, { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" }, { code: "es", label: "Español" }, { code: "it", label: "Italiano" }, { code: "ru", label: "Русский" },
];

const supported = new Set(labels.map((item) => item.code));
const detected = (getLocales()[0]?.languageCode || "en").toLowerCase() as AppLanguage;
const initialLanguage: AppLanguage = supported.has(detected) ? detected : "en";

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(initialLanguage);

  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && supported.has(saved as AppLanguage)) setLanguageState(saved as AppLanguage);
    }).catch(() => undefined);
  }, []);

  const setLanguage = async (next: AppLanguage) => {
    setLanguageState(next);
    try { await AsyncStorage.setItem(STORAGE_KEY, next); } catch { /* best effort */ }
  };

  const value = useMemo<I18nValue>(() => ({
    language,
    languages: labels,
    setLanguage,
    t: (key, vars) => {
      let value = dictionaries[language][key] ?? dictionaries.en[key] ?? key;
      Object.entries(vars ?? {}).forEach(([name, replacement]) => {
        value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(replacement));
      });
      return value;
    },
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
