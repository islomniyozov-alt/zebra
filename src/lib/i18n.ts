// ---------------------------------------------------------------------------
// EN, RU, FA — from the first component, never retrofitted (§12).
//
// Two facts shape everything below:
//
//   * Russian runs roughly 30% longer than English. No fixed-width buttons,
//     labels or table headers anywhere. The dictionaries below are the reason
//     to check that at build time rather than after a user complains.
//   * Farsi is right-to-left. `dir` comes from the locale and nothing else,
//     and every stylesheet uses logical properties so the flip is free.
//
// Deliberately not a library. Three locales and a flat key space do not need
// one, and a library would put its own opinions between the key and the
// string. If this grows past a few hundred keys, revisit.
// ---------------------------------------------------------------------------

export const LOCALES = ['en', 'ru', 'fa'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: string | undefined | null): value is Locale {
  return (
    value !== null && value !== undefined && LOCALES.includes(value as Locale)
  )
}

/** Farsi is the only right-to-left locale here, but ask rather than assume. */
export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'fa' ? 'rtl' : 'ltr'
}

const en = {
  'app.name': 'Zebra',

  'nav.group.operations': 'Operations',
  'nav.group.fleet': 'Fleet',
  'nav.group.money': 'Money',
  'nav.group.records': 'Records',
  'nav.group.admin': 'Admin',
  'nav.dashboard': 'Dashboard',
  'nav.dispatch': 'Dispatch',
  'nav.loads': 'Loads',
  'nav.calendar': 'Calendar',
  'nav.trucks': 'Trucks',
  'nav.trailers': 'Trailers',
  'nav.drivers': 'Drivers',
  'nav.maintenance': 'Maintenance',
  'nav.invoices': 'Invoices',
  'nav.receivables': 'Receivables',
  'nav.payments': 'Payments',
  'nav.settlements': 'Settlements',
  'nav.expenses': 'Expenses',
  'nav.fuel': 'Fuel',
  'nav.brokers': 'Brokers',
  'nav.documents': 'Documents',
  'nav.reports': 'Reports',
  'nav.users': 'Users',
  'nav.settings': 'Settings',

  'topbar.search': 'Search',
  'topbar.searchHint': 'Search loads, invoices, trucks',
  'topbar.allAuthorities': 'All authorities',
  'topbar.notifications': 'Notifications',
  'topbar.userMenu': 'Account',
  'topbar.signOut': 'Sign out',

  'density.label': 'Density',
  'density.compact': 'Compact',
  'density.standard': 'Standard',
  'density.comfortable': 'Comfortable',

  'loads.title': 'Loads',
  'loads.stripeMeaning': 'Stripe shows operational status',
  'loads.column.load': 'Load',
  'loads.column.company': 'Authority',
  'loads.column.customer': 'Broker',
  'loads.column.pickup': 'Pickup',
  'loads.column.delivery': 'Delivery',
  'loads.column.truck': 'Truck',
  'loads.column.driver': 'Driver',
  'loads.column.status': 'Status',
  'loads.column.billing': 'Billing',
  'loads.column.rate': 'Rate',
  'loads.empty.title': 'No loads yet',
  'loads.empty.body':
    'Booked loads appear here as soon as the first one is entered.',
  'loads.emptyFiltered.title': 'No loads match these filters',
  'loads.emptyFiltered.body':
    'Nothing in this view matches what you have selected.',
  'loads.filter.clear': 'Clear filters',
  'loads.filter.status': 'Status',
  'loads.filter.billing': 'Billing',
  'loads.filter.authority': 'Authority',
  'loads.filter.more': 'More filters',
  'loads.export': 'Export',

  'auth.signIn': 'Sign in',
  'auth.signInTo': 'Sign in to Zebra',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.forgot': 'Forgot your password?',
  'auth.invalid': 'That email and password do not match.',
  'auth.rateLimited': 'Too many attempts. Try again in fifteen minutes.',
  'auth.noMembership': 'That account is not attached to an organization.',
  'auth.reset.title': 'Reset your password',
  'auth.reset.body':
    'Enter your email and we will send a link to set a new password.',
  'auth.reset.send': 'Send reset link',
  'auth.reset.sent': 'If that account exists, a reset link is on its way.',
  'auth.reset.newPassword': 'New password',
  'auth.reset.confirmPassword': 'Confirm new password',
  'auth.reset.save': 'Set new password',
  'auth.reset.mismatch': 'Those two passwords do not match.',
  'auth.reset.tooShort': 'Use at least twelve characters.',
  'auth.reset.invalidToken':
    'That reset link has expired or has already been used.',
  'auth.reset.done': 'Password changed. Sign in with the new one.',
  'auth.backToSignIn': 'Back to sign in',

  'status.AVAILABLE': 'Available',
  'status.BOOKED': 'Booked',
  'status.DISPATCHED': 'Dispatched',
  'status.AT_PICKUP': 'At pickup',
  'status.LOADED': 'Loaded',
  'status.IN_TRANSIT': 'In transit',
  'status.AT_DELIVERY': 'At delivery',
  'status.DELIVERED': 'Delivered',
  'status.POD_RECEIVED': 'POD received',
  'billing.UNINVOICED': 'Uninvoiced',
  'billing.READY_TO_INVOICE': 'Ready to invoice',
  'billing.INVOICED': 'Invoiced',
  'billing.PARTIALLY_PAID': 'Partially paid',
  'billing.PAID': 'Paid',
  'billing.DISPUTED': 'Disputed',
  'billing.WRITTEN_OFF': 'Written off',

  'upload.preparing': 'Preparing',
  'upload.uploading': 'Uploading',
  'upload.done': 'Uploaded',
  'upload.failed': 'Upload failed',
  'upload.retry': 'Retry',
} as const

export type MessageKey = keyof typeof en

type Dictionary = Record<MessageKey, string>

const ru: Dictionary = {
  'app.name': 'Zebra',

  'nav.group.operations': 'Операции',
  'nav.group.fleet': 'Автопарк',
  'nav.group.money': 'Финансы',
  'nav.group.records': 'Справочники',
  'nav.group.admin': 'Администрирование',
  'nav.dashboard': 'Панель',
  'nav.dispatch': 'Диспетчеризация',
  'nav.loads': 'Грузы',
  'nav.calendar': 'Календарь',
  'nav.trucks': 'Тягачи',
  'nav.trailers': 'Прицепы',
  'nav.drivers': 'Водители',
  'nav.maintenance': 'Обслуживание',
  'nav.invoices': 'Счета',
  'nav.receivables': 'Дебиторская задолженность',
  'nav.payments': 'Платежи',
  'nav.settlements': 'Расчёты с водителями',
  'nav.expenses': 'Расходы',
  'nav.fuel': 'Топливо',
  'nav.brokers': 'Брокеры',
  'nav.documents': 'Документы',
  'nav.reports': 'Отчёты',
  'nav.users': 'Пользователи',
  'nav.settings': 'Настройки',

  'topbar.search': 'Поиск',
  'topbar.searchHint': 'Поиск грузов, счетов, тягачей',
  'topbar.allAuthorities': 'Все перевозчики',
  'topbar.notifications': 'Уведомления',
  'topbar.userMenu': 'Учётная запись',
  'topbar.signOut': 'Выйти',

  'density.label': 'Плотность',
  'density.compact': 'Компактная',
  'density.standard': 'Стандартная',
  'density.comfortable': 'Свободная',

  'loads.title': 'Грузы',
  'loads.stripeMeaning': 'Полоса показывает операционный статус',
  'loads.column.load': 'Груз',
  'loads.column.company': 'Перевозчик',
  'loads.column.customer': 'Брокер',
  'loads.column.pickup': 'Погрузка',
  'loads.column.delivery': 'Выгрузка',
  'loads.column.truck': 'Тягач',
  'loads.column.driver': 'Водитель',
  'loads.column.status': 'Статус',
  'loads.column.billing': 'Оплата',
  'loads.column.rate': 'Ставка',
  'loads.empty.title': 'Грузов пока нет',
  'loads.empty.body':
    'Забронированные грузы появятся здесь, как только будет добавлен первый.',
  'loads.emptyFiltered.title': 'Нет грузов по этим фильтрам',
  'loads.emptyFiltered.body': 'Ничего не соответствует выбранным условиям.',
  'loads.filter.clear': 'Сбросить фильтры',
  'loads.filter.status': 'Статус',
  'loads.filter.billing': 'Оплата',
  'loads.filter.authority': 'Перевозчик',
  'loads.filter.more': 'Ещё фильтры',
  'loads.export': 'Экспорт',

  'auth.signIn': 'Войти',
  'auth.signInTo': 'Вход в Zebra',
  'auth.email': 'Электронная почта',
  'auth.password': 'Пароль',
  'auth.forgot': 'Забыли пароль?',
  'auth.invalid': 'Электронная почта и пароль не совпадают.',
  'auth.rateLimited':
    'Слишком много попыток. Повторите через пятнадцать минут.',
  'auth.noMembership': 'Эта учётная запись не привязана к организации.',
  'auth.reset.title': 'Сброс пароля',
  'auth.reset.body':
    'Введите адрес электронной почты, и мы отправим ссылку для установки нового пароля.',
  'auth.reset.send': 'Отправить ссылку',
  'auth.reset.sent':
    'Если такая учётная запись существует, ссылка уже отправлена.',
  'auth.reset.newPassword': 'Новый пароль',
  'auth.reset.confirmPassword': 'Повторите новый пароль',
  'auth.reset.save': 'Установить новый пароль',
  'auth.reset.mismatch': 'Пароли не совпадают.',
  'auth.reset.tooShort': 'Используйте не менее двенадцати символов.',
  'auth.reset.invalidToken':
    'Срок действия ссылки истёк или она уже использована.',
  'auth.reset.done': 'Пароль изменён. Войдите с новым паролем.',
  'auth.backToSignIn': 'Вернуться ко входу',

  'status.AVAILABLE': 'Свободен',
  'status.BOOKED': 'Забронирован',
  'status.DISPATCHED': 'Отправлен',
  'status.AT_PICKUP': 'На погрузке',
  'status.LOADED': 'Загружен',
  'status.IN_TRANSIT': 'В пути',
  'status.AT_DELIVERY': 'На выгрузке',
  'status.DELIVERED': 'Доставлен',
  'status.POD_RECEIVED': 'POD получен',
  'billing.UNINVOICED': 'Без счёта',
  'billing.READY_TO_INVOICE': 'Готов к выставлению',
  'billing.INVOICED': 'Счёт выставлен',
  'billing.PARTIALLY_PAID': 'Частично оплачен',
  'billing.PAID': 'Оплачен',
  'billing.DISPUTED': 'Оспаривается',
  'billing.WRITTEN_OFF': 'Списан',

  'upload.preparing': 'Подготовка',
  'upload.uploading': 'Загрузка',
  'upload.done': 'Загружено',
  'upload.failed': 'Не удалось загрузить',
  'upload.retry': 'Повторить',
}

const fa: Dictionary = {
  'app.name': 'Zebra',

  'nav.group.operations': 'عملیات',
  'nav.group.fleet': 'ناوگان',
  'nav.group.money': 'مالی',
  'nav.group.records': 'سوابق',
  'nav.group.admin': 'مدیریت',
  'nav.dashboard': 'داشبورد',
  'nav.dispatch': 'اعزام',
  'nav.loads': 'بارها',
  'nav.calendar': 'تقویم',
  'nav.trucks': 'کامیون‌ها',
  'nav.trailers': 'تریلرها',
  'nav.drivers': 'رانندگان',
  'nav.maintenance': 'تعمیرات',
  'nav.invoices': 'فاکتورها',
  'nav.receivables': 'مطالبات',
  'nav.payments': 'پرداخت‌ها',
  'nav.settlements': 'تسویه رانندگان',
  'nav.expenses': 'هزینه‌ها',
  'nav.fuel': 'سوخت',
  'nav.brokers': 'کارگزاران',
  'nav.documents': 'اسناد',
  'nav.reports': 'گزارش‌ها',
  'nav.users': 'کاربران',
  'nav.settings': 'تنظیمات',

  'topbar.search': 'جستجو',
  'topbar.searchHint': 'جستجوی بار، فاکتور، کامیون',
  'topbar.allAuthorities': 'همه شرکت‌ها',
  'topbar.notifications': 'اعلان‌ها',
  'topbar.userMenu': 'حساب کاربری',
  'topbar.signOut': 'خروج',

  'density.label': 'تراکم',
  'density.compact': 'فشرده',
  'density.standard': 'استاندارد',
  'density.comfortable': 'راحت',

  'loads.title': 'بارها',
  'loads.stripeMeaning': 'نوار رنگی وضعیت عملیاتی را نشان می‌دهد',
  'loads.column.load': 'بار',
  'loads.column.company': 'شرکت',
  'loads.column.customer': 'کارگزار',
  'loads.column.pickup': 'بارگیری',
  'loads.column.delivery': 'تحویل',
  'loads.column.truck': 'کامیون',
  'loads.column.driver': 'راننده',
  'loads.column.status': 'وضعیت',
  'loads.column.billing': 'صورتحساب',
  'loads.column.rate': 'نرخ',
  'loads.empty.title': 'هنوز باری ثبت نشده است',
  'loads.empty.body':
    'به‌محض ثبت اولین بار، بارهای رزروشده اینجا نمایش داده می‌شوند.',
  'loads.emptyFiltered.title': 'هیچ باری با این فیلترها مطابقت ندارد',
  'loads.emptyFiltered.body': 'موردی با شرایط انتخاب‌شده مطابقت ندارد.',
  'loads.filter.clear': 'پاک کردن فیلترها',
  'loads.filter.status': 'وضعیت',
  'loads.filter.billing': 'صورتحساب',
  'loads.filter.authority': 'شرکت',
  'loads.filter.more': 'فیلترهای بیشتر',
  'loads.export': 'خروجی',

  'auth.signIn': 'ورود',
  'auth.signInTo': 'ورود به Zebra',
  'auth.email': 'ایمیل',
  'auth.password': 'گذرواژه',
  'auth.forgot': 'گذرواژه را فراموش کرده‌اید؟',
  'auth.invalid': 'ایمیل و گذرواژه مطابقت ندارند.',
  'auth.rateLimited': 'تلاش‌های بیش از حد. پانزده دقیقه دیگر دوباره تلاش کنید.',
  'auth.noMembership': 'این حساب به هیچ سازمانی متصل نیست.',
  'auth.reset.title': 'بازنشانی گذرواژه',
  'auth.reset.body':
    'ایمیل خود را وارد کنید تا پیوند تعیین گذرواژه تازه ارسال شود.',
  'auth.reset.send': 'ارسال پیوند بازنشانی',
  'auth.reset.sent': 'اگر چنین حسابی وجود داشته باشد، پیوند ارسال شد.',
  'auth.reset.newPassword': 'گذرواژه تازه',
  'auth.reset.confirmPassword': 'تکرار گذرواژه تازه',
  'auth.reset.save': 'ثبت گذرواژه تازه',
  'auth.reset.mismatch': 'دو گذرواژه یکسان نیستند.',
  'auth.reset.tooShort': 'حداقل دوازده نویسه استفاده کنید.',
  'auth.reset.invalidToken': 'این پیوند منقضی شده یا قبلاً استفاده شده است.',
  'auth.reset.done': 'گذرواژه تغییر کرد. با گذرواژه تازه وارد شوید.',
  'auth.backToSignIn': 'بازگشت به ورود',

  'status.AVAILABLE': 'آزاد',
  'status.BOOKED': 'رزرو شده',
  'status.DISPATCHED': 'اعزام شده',
  'status.AT_PICKUP': 'در محل بارگیری',
  'status.LOADED': 'بارگیری شده',
  'status.IN_TRANSIT': 'در مسیر',
  'status.AT_DELIVERY': 'در محل تحویل',
  'status.DELIVERED': 'تحویل شده',
  'status.POD_RECEIVED': 'رسید تحویل دریافت شد',
  'billing.UNINVOICED': 'بدون فاکتور',
  'billing.READY_TO_INVOICE': 'آماده فاکتور',
  'billing.INVOICED': 'فاکتور شده',
  'billing.PARTIALLY_PAID': 'پرداخت جزئی',
  'billing.PAID': 'پرداخت شده',
  'billing.DISPUTED': 'مورد اختلاف',
  'billing.WRITTEN_OFF': 'سوخت‌شده',

  'upload.preparing': 'در حال آماده‌سازی',
  'upload.uploading': 'در حال بارگذاری',
  'upload.done': 'بارگذاری شد',
  'upload.failed': 'بارگذاری ناموفق بود',
  'upload.retry': 'تلاش دوباره',
}

const DICTIONARIES: Record<Locale, Dictionary> = { en, ru, fa }

export type Translate = (key: MessageKey) => string

/**
 * A translator bound to one locale.
 *
 * Falls back to English rather than to the key, because a half-translated
 * screen is usable and `loads.column.pickup` is not. Missing keys cannot
 * happen anyway — `Dictionary` requires every key of `en`, so a forgotten
 * translation is a type error, not a runtime blank.
 */
export function translator(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale]
  return (key) => dictionary[key] ?? en[key]
}

/**
 * Never translate: load numbers, invoice numbers, VINs, MC/DOT numbers, and
 * status codes in exports (§12). Exports are machine-read downstream, so this
 * is the formatter for a code that must survive a locale change unaltered.
 */
export function untranslated(value: string): string {
  return value
}
