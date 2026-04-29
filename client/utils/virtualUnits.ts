/**
 * Virtual Unit System - Система виртуальных единиц измерения
 *
 * Базовая единица: 1 VU = viewportHeight / 1000 pixels
 * Вычисляется динамически через JavaScript для стабильности при zoom
 *
 * Формула: pixelsPerVU = viewportHeight / 1000
 * Примеры:
 * - Высота окна 1080px: 1 VU = 1.08px
 * - Высота окна 720px: 1 VU = 0.72px
 * - Высота окна 1920px: 1 VU = 1.92px
 */

// Базовая единица измерения
export const VU_BASE_PERCENT = 0.1; // 1 VU = 0.1% от высоты (для обратной совместимости)
export const VU_DIVISOR = 1000; // делитель для формулы pixelsPerVU = viewportHeight / 1000

// Для конверсии в пиксели (используется только для ссылочных значений)
export const VU_REFERENCE_HEIGHT = 1080; // эталонная высота для расчетов
export const VU_REFERENCE_PX = VU_REFERENCE_HEIGHT / VU_DIVISOR; // 1.08px при 1080px

/**
 * Вычисляет текущее значение 1 VU в пикселях
 * Использует window.innerHeight (CSS пиксели) для правильной компенсации zoom браузера
 * @returns значение 1 VU в пикселях
 */
export const computeVUPixels = (): number => {
  return window.innerHeight / VU_DIVISOR
}

/**
 * Инициализирует CSS переменную --vu-base-px с текущим значением VU в пикселях
 * Вызывайте при загрузке и изменении размера окна
 */
export const initializeVUBasePixels = (): void => {
  const vuPixels = computeVUPixels()
  const viewportHeight = window.innerHeight
  document.documentElement.style.setProperty('--vu-base-px', `${vuPixels}px`)

  // Проверим что переменная установилась
  const root = document.documentElement
  const computedValue = root.style.getPropertyValue('--vu-base-px')
  const computedStyle = window.getComputedStyle(root)
  const cssVarValue = computedStyle.getPropertyValue('--vu-base-px')
}

/**
 * Основные размеры в виртуальных единицах
 * Все размеры кратны базовой единице (0.1% высоты окна)
 * Рассчитаны для сохранения пропорций при высоте окна 1080px
 */
export const SIZES_VU = {
  // === Отступы и промежутки ===
  gap_min: 4,      // ~4px - минимальный отступ
  gap_base: 7,     // ~8px - базовый отступ
  gap_md: 11,      // ~12px - средний отступ
  gap_lg: 15,      // ~16px - большой отступ
  gap_xl: 22,      // ~24px - экстра большой отступ
  gap_2xl: 30,     // ~32px - огромный отступ

  // === Размеры карточек ===
  card_tiny: 59,    // ~64px - очень маленькая (статус иконки)
  card_small: 104,  // ~112px - маленькая (предпросмотр)
  card_normal: 118, // ~128px - обычная (основной размер)
  card_large: 148,  // ~160px - большая (детальный просмотр)
  card_xl: 178,     // ~192px - очень большая

  // === Размеры панелей ===
  header_height: 52,  // ~56px - высота хедера
  panel_padding: 11,  // ~12px - отступ внутри панелей
  panel_gap: 7,       // ~8px - промежуток между элементами панели

  // === Модальные окна ===
  modal_sm: 185,   // ~200px - маленькое модальное окно
  modal_md: 222,   // ~240px - среднее модальное окно
  modal_lg: 370,   // ~400px - большое модальное окно
  modal_xl: 593,   // ~640px - очень большое модальное окно

  // === Размеры текста ===
  text_xs: 6,      // ~6px - очень маленький текст
  text_sm: 6,      // ~7px - маленький текст
  text_base: 7,    // ~8px - базовый размер текста
  text_md: 8,      // ~9px - средний текст
  text_lg: 9,      // ~10px - большой текст
  text_xl: 11,     // ~12px - очень большой текст
  text_2xl: 15,    // ~16px - заголовок
  text_3xl: 19,    // ~20px - большой заголовок
  // Увеличенные размеры для特定 элементов (в 2-3 раза больше базовых)
  text_deck: 13,   // ~14px - надписи deck/discard/showcase (в 2 раза больше text_base)
  text_header: 18, // ~19px - текст верхней панели (в 3 раза больше text_md)
  text_score: 27,  // ~29px - счётчик очков (в 3 раза больше text_lg)
  text_8: 8,       // ~9px - шрифт числа количества на счетчиках
  text_4xl: 27,    // ~29px - огромный текст (в 3 раза больше text_xl)
  text_5xl: 33,    // ~36px - гигантский текст (в 3 раза больше text_2xl)
  text_6xl: 57,    // ~62px - колоссальный текст (в 3 раза больше text_3xl)

  // === Размеры кнопок ===
  btn_sm: 15,      // ~16px - маленькая кнопка
  btn_md: 22,      // ~24px - средняя кнопка
  btn_lg: 30,      // ~32px - большая кнопка
  btn_xl: 60,      // ~64px - очень большая кнопка (для увеличенных счетчиков)
  btn_40: 40,      // ~43px - специальный размер 40 VU для счетчиков

  // === Размеры иконок ===
  icon_xs: 7,      // ~8px - очень маленькая иконка
  icon_sm: 11,     // ~12px - маленькая иконка
  icon_md: 15,     // ~16px - средняя иконка
  icon_lg: 22,     // ~24px - большая иконка
  icon_xl: 30,     // ~32px - очень большая иконка (для увеличенных счетчиков)
  icon_18: 18,     // ~19px - значки на картах (обычные)
  icon_15: 15,     // ~16px - значки на картах (с количеством)

  // === Размеры игрового поля ===
  board_gap: 4,    // ~4px - промежуток между ячейками
  cell_min: 59,    // ~64px - минимальный размер ячейки
  cell_base: 104,  // ~112px - базовый размер ячейки
  cell_large: 118, // ~128px - большой размер ячейки

  // === Размеры для оптимизации изображений ===
  image_tiny: 46,     // ~50px - мгновенная загрузка
  image_small: 59,    // ~64px - маленькое изображение
  image_preview: 139, // ~150px - предпросмотр
  image_normal: 278,  // ~300px - обычное изображение
  image_large: 370,   // ~400px - большое изображение

  // === Размеры скроллбаров ===
  scrollbar_thin: 6,    // ~6px - тонкий скроллбар
  scrollbar_normal: 9,  // ~10px - обычный скроллбар

  // === Размеры эффектов и анимаций ===
  effect_sm: 4,   // ~4px - маленький эффект
  effect_md: 7,   // ~8px - средний эффект
  effect_lg: 11,  // ~12px - большой эффект

  // === Позиции ===
  pos_header_offset: 55,  // ~59px - смещение от хедера (56px + 3px)
  pos_corner: 3,          // ~3px - отступ от угла экрана
} as const;

/**
 * CSS переменные для использования в стилях
 * Используют --vu-base-px которая вычисляется через JavaScript для стабильности при zoom
 */
export const VU_CSS_VARIABLES = {
  '--vu-base': 'var(--vu-base-px)', // базовая единица в пикселях

  // Отступы
  '--vu-gap-min': 'calc(4 * var(--vu-base-px))',
  '--vu-gap-base': 'calc(7 * var(--vu-base-px))',
  '--vu-gap-md': 'calc(11 * var(--vu-base-px))',
  '--vu-gap-lg': 'calc(15 * var(--vu-base-px))',
  '--vu-gap-xl': 'calc(22 * var(--vu-base-px))',
  '--vu-gap-2xl': 'calc(30 * var(--vu-base-px))',

  // Размеры карточек
  '--vu-card-tiny': 'calc(59 * var(--vu-base-px))',
  '--vu-card-small': 'calc(104 * var(--vu-base-px))',
  '--vu-card-normal': 'calc(118 * var(--vu-base-px))',
  '--vu-card-large': 'calc(148 * var(--vu-base-px))',
  '--vu-card-xl': 'calc(178 * var(--vu-base-px))',

  // Панели
  '--vu-header-height': 'calc(52 * var(--vu-base-px))',
  '--vu-panel-padding': 'calc(11 * var(--vu-base-px))',
  '--vu-panel-gap': 'calc(7 * var(--vu-base-px))',

  // Модальные окна
  '--vu-modal-sm': 'calc(185 * var(--vu-base-px))',
  '--vu-modal-md': 'calc(222 * var(--vu-base-px))',
  '--vu-modal-lg': 'calc(370 * var(--vu-base-px))',
  '--vu-modal-xl': 'calc(593 * var(--vu-base-px))',

  // Размеры текста
  '--vu-text-xs': 'calc(6 * var(--vu-base-px))',
  '--vu-text-sm': 'calc(6 * var(--vu-base-px))',
  '--vu-text-base': 'calc(7 * var(--vu-base-px))',
  '--vu-text-md': 'calc(8 * var(--vu-base-px))',
  '--vu-text-lg': 'calc(9 * var(--vu-base-px))',
  '--vu-text-xl': 'calc(11 * var(--vu-base-px))',
  '--vu-text-2xl': 'calc(15 * var(--vu-base-px))',
  '--vu-text-3xl': 'calc(19 * var(--vu-base-px))',
  // Увеличенные размеры для-specific элементов
  '--vu-text-deck': 'calc(13 * var(--vu-base-px))',
  '--vu-text-header': 'calc(18 * var(--vu-base-px))',
  '--vu-text-score': 'calc(27 * var(--vu-base-px))',
  '--vu-text-8': 'calc(8 * var(--vu-base-px))',
  '--vu-text-4xl': 'calc(27 * var(--vu-base-px))',
  '--vu-text-5xl': 'calc(33 * var(--vu-base-px))',
  '--vu-text-6xl': 'calc(57 * var(--vu-base-px))',

  // Кнопки
  '--vu-btn-sm': 'calc(15 * var(--vu-base-px))',
  '--vu-btn-md': 'calc(22 * var(--vu-base-px))',
  '--vu-btn-lg': 'calc(30 * var(--vu-base-px))',
  '--vu-btn-xl': 'calc(60 * var(--vu-base-px))',
  '--vu-btn-40': 'calc(40 * var(--vu-base-px))',

  // Иконки
  '--vu-icon-xs': 'calc(7 * var(--vu-base-px))',
  '--vu-icon-sm': 'calc(11 * var(--vu-base-px))',
  '--vu-icon-md': 'calc(15 * var(--vu-base-px))',
  '--vu-icon-lg': 'calc(22 * var(--vu-base-px))',
  '--vu-icon-xl': 'calc(30 * var(--vu-base-px))',
  '--vu-icon-18': 'calc(18 * var(--vu-base-px))',
  '--vu-icon-15': 'calc(15 * var(--vu-base-px))',

  // Игровое поле
  '--vu-board-gap': 'calc(4 * var(--vu-base-px))',
  '--vu-cell-min': 'calc(59 * var(--vu-base-px))',
  '--vu-cell-base': 'calc(104 * var(--vu-base-px))',
  '--vu-cell-large': 'calc(118 * var(--vu-base-px))',

  // Изображения
  '--vu-image-tiny': 'calc(46 * var(--vu-base-px))',
  '--vu-image-small': 'calc(59 * var(--vu-base-px))',
  '--vu-image-preview': 'calc(139 * var(--vu-base-px))',
  '--vu-image-normal': 'calc(278 * var(--vu-base-px))',
  '--vu-image-large': 'calc(370 * var(--vu-base-px))',

  // Скроллбары
  '--vu-scrollbar-thin': 'calc(6 * var(--vu-base-px))',
  '--vu-scrollbar-normal': 'calc(9 * var(--vu-base-px))',

  // Эффекты
  '--vu-effect-sm': 'calc(4 * var(--vu-base-px))',
  '--vu-effect-md': 'calc(7 * var(--vu-base-px))',
  '--vu-effect-lg': 'calc(11 * var(--vu-base-px))',

  // Позиции
  '--vu-pos-header-offset': 'calc(55 * var(--vu-base-px))',
  '--vu-pos-corner': 'calc(3 * var(--vu-base-px))',
} as const;

/**
 * Вспомогательные функции для конверсии
 * Примечание: Эти функции дают приблизительные значения в пикселях
 * Реальные размеры зависят от высоты окна браузера
 */

/**
 * Конвертирует VU в примерное количество пикселей (для высоты окна 1080px)
 * @param vu - значение в виртуальных единицах
 * @returns примерное значение в пикселях
 */
export const vuToApproxPx = (vu: number): number => Math.round(vu * VU_REFERENCE_PX);

/**
 * Конвертирует пиксели в примерное количество VU (для высоты окна 1080px)
 * @param px - значение в пикселях
 * @returns примерное значение в виртуальных единицах
 */
export const pxToApproxVu = (px: number): number => Math.round((px / VU_REFERENCE_PX) * 100) / 100;

/**
 * Конвертирует VU в CSS calc() выражение
 * @param vu - значение в виртуальных единицах
 * @returns CSS calc() выражение
 */
export const vuToCss = (vu: number): string => `calc(${vu} * var(--vu-base-px))`;

/**
 * Типизированные размеры для использования в компонентах
 */
export type VUSize = keyof typeof SIZES_VU;

/**
 * Получить примерный размер в пикселях (для высоты окна 1080px)
 * @param size - имя размера из SIZES_VU
 * @returns примерное значение в пикселях
 */
export const getSizeInApproxPx = (size: VUSize): number => {
  return vuToApproxPx(SIZES_VU[size]);
};

/**
 * Получить CSS calc() выражение для размера
 * @param size - имя размера из SIZES_VU
 * @returns CSS calc() выражение
 */
export const getSizeCss = (size: VUSize): string => {
  return vuToCss(SIZES_VU[size]);
};