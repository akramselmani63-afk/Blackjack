const I18N = {
  en: {
    dir: 'ltr',
    title: '21 — The Bayou Game',
    subtitle: 'A game of nerves, not luck.',
    name: 'Your Name',
    quickMatch: 'Quick Match',
    createRoom: 'Create Room',
    joinRoom: 'Join Room',
    roomCode: 'Room Code',
    cancel: 'Cancel',
    inQueue: 'Waiting for an opponent...',
    yourHand: 'Your Hand',
    opponent: 'Opponent',
    strikes: 'Strikes',
    phase: 'Phase',
    extraStake: 'Extra Stakes',
    hit: 'Hit',
    stand: 'Stand',
    playTrump: 'Play Trump',
    yourTurn: 'Your Turn',
    waiting: 'Waiting for opponent...',
    youStood: 'You stood',
    oppStood: 'Opponent stood',
    youFrozen: 'You are frozen',
    oppFrozen: 'Opponent frozen',
    roundLog: 'Round Log',
    shareCode: 'Share this code with your friend:',
    joinedRoom: 'Joined room',
    copy: 'Copy',
    copied: 'Copied!',
    trumpHand: 'Your Trump Cards',
    noTrumps: 'No trumps remaining',
    categories: { value: 'Value', disruption: 'Disruption', bet: 'Bet', reversal: 'Reversal' },
    matchEnd: 'Match Over',
    youWin: 'You win the match!',
    youLose: 'You lost the match.',
    backToLobby: 'Back to Lobby',
    error: 'Error',
  },
  ar: {
    dir: 'rtl',
    title: '٢١ — لعبة المستنقع',
    subtitle: 'لعبة أعصاب، لا حظ.',
    name: 'اسمك',
    quickMatch: 'مباراة سريعة',
    createRoom: 'إنشاء غرفة',
    joinRoom: 'انضمام لغرفة',
    roomCode: 'رمز الغرفة',
    cancel: 'إلغاء',
    inQueue: 'في انتظار الخصم...',
    yourHand: 'ورقك',
    opponent: 'الخصم',
    strikes: 'الضربات',
    phase: 'المرحلة',
    extraStake: 'رهانات إضافية',
    hit: 'اسحب',
    stand: 'توقف',
    playTrump: 'العب ورقة رابحة',
    yourTurn: 'دورك',
    waiting: 'في انتظار الخصم...',
    youStood: 'توقفت',
    oppStood: 'الخصم توقف',
    youFrozen: 'أنت متجمد',
    oppFrozen: 'الخصم متجمد',
    roundLog: 'سجل الجولة',
    shareCode: 'شارك هذا الرمز مع صديقك:',
    joinedRoom: 'انضممت إلى الغرفة',
    copy: 'نسخ',
    copied: 'تم النسخ!',
    trumpHand: 'أوراقك الرابحة',
    noTrumps: 'لا توجد أوراق رابحة',
    categories: { value: 'قيمة', disruption: 'تعطيل', bet: 'رهان', reversal: 'عكس' },
    matchEnd: 'انتهت المباراة',
    youWin: 'لقد فزت بالمباراة!',
    youLose: 'لقد خسرت المباراة.',
    backToLobby: 'العودة إلى الردهة',
    error: 'خطأ',
  }
};

let currentLang = localStorage.getItem('lang21') || 'en';

function t(key) {
  const keys = key.split('.');
  let val = I18N[currentLang];
  for (const k of keys) val = val?.[k];
  return val ?? key;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang21', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = I18N[lang].dir;
  renderAll();
}

function renderAll() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
