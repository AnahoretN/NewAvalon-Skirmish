/**
 * React Hook для работы с виртуальными единицами измерения
 * 1 VU = 0.1% от высоты окна (динамическая единица, автоматически компенсирует zoom)
 * Позволяет компонентам использовать полностью адаптивную систему размеров
 */

import { useMemo, useEffect, useState } from 'react';
import { SIZES_VU, VU_BASE_VH, vuToApproxPx, pxToApproxVu, type VUSize } from '@/utils/virtualUnits';

interface UseVUReturn {
  // Текущая высота окна в пикселях
  windowHeight: number;

  // Коэффициент конверсии (сколько px в 1 VU)
  pxPerVU: number;

  // Конверсия (на основе текущей высоты окна)
  px: (vu: number) => number;
  vu: (px: number) => number;

  // Предвычисленные значения в px (динамические!)
  sizes: {
    // Отступы
    gapMin: number;
    gapBase: number;
    gapMd: number;
    gapLg: number;
    gapXl: number;
    gap2xl: number;

    // Карточки
    cardTiny: number;
    cardSmall: number;
    cardNormal: number;
    cardLarge: number;
    cardXl: number;

    // Панели
    headerHeight: number;
    panelPadding: number;
    panelGap: number;

    // Модальные окна
    modalSm: number;
    modalMd: number;
    modalLg: number;
    modalXl: number;

    // Текст
    textXs: number;
    textSm: number;
    textBase: number;
    textMd: number;
    textLg: number;
    textXl: number;
    text2xl: number;
    text3xl: number;

    // Кнопки
    btnSm: number;
    btnMd: number;
    btnLg: number;

    // Иконки
    iconXs: number;
    iconSm: number;
    iconMd: number;
    iconLg: number;

    // Игровое поле
    boardGap: number;
    cellMin: number;
    cellBase: number;
    cellLarge: number;

    // Изображения
    imageTiny: number;
    imageSmall: number;
    imagePreview: number;
    imageNormal: number;
    imageLarge: number;

    // Скроллбары
    scrollbarThin: number;
    scrollbarNormal: number;

    // Эффекты
    effectSm: number;
    effectMd: number;
    effectLg: number;

    // Позиции
    posHeaderOffset: number;
    posCorner: number;
  };

  // CSS calc() выражения для использования в стилях
  css: {
    // Отступы
    gapMin: string;
    gapBase: string;
    gapMd: string;
    gapLg: string;
    gapXl: string;
    gap2xl: string;

    // Размеры карточек
    cardTiny: string;
    cardSmall: string;
    cardNormal: string;
    cardLarge: string;
    cardXl: string;

    // Размеры панелей
    headerHeight: string;
    panelPadding: string;
    panelGap: string;

    // Модальные окна
    modalSm: string;
    modalMd: string;
    modalLg: string;
    modalXl: string;

    // Текст
    textXs: string;
    textSm: string;
    textBase: string;
    textMd: string;
    textLg: string;
    textXl: string;
    text2xl: string;
    text3xl: string;

    // Кнопки
    btnSm: string;
    btnMd: string;
    btnLg: string;

    // Иконки
    iconXs: string;
    iconSm: string;
    iconMd: string;
    iconLg: string;

    // Игровое поле
    boardGap: string;
    cellMin: string;
    cellBase: string;
    cellLarge: string;
  };

  // Получить размер по имени (в px)
  getSize: (size: VUSize) => number;

  // Получить CSS calc() выражение для размера
  getSizeCss: (size: VUSize) => string;
}

/**
 * Hook для работы с виртуальными единицами измерения
 * 1 VU = 0.1% от высоты окна (динамически!)
 *
 * @returns объект с методами и размерами в VU
 *
 * @example
 * ```tsx
 * const { sizes, css } = useVU();
 *
 * // Использование динамических размеров в пикселях
 * <div style={{ width: sizes.cardNormal, height: sizes.cardNormal }}>
 *   Card content
 * </div>
 *
 * // Использование CSS calc() выражений
 * <div style={{ width: css.cardNormal, height: css.cardNormal }}>
 *   Card content
 * </div>
 * ```
 */
export const useVU = (): UseVUReturn => {
  const [windowHeight, setWindowHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerHeight;
    }
    return 1080; // Значение по умолчанию для SSR
  });

  // Отслеживание изменения размера окна
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return useMemo(() => {
    // Коэффициент конверсии: сколько px в 1 VU
    const pxPerVU = windowHeight * VU_BASE_VH;

    // Конверсия функций
    const px = (vu: number): number => Math.round(vu * pxPerVU);
    const vu = (pxVal: number): number => Math.round((pxVal / pxPerVU) * 100) / 100;

    // CSS calc() генератор
    const calcCss = (vuValue: number): string => `calc(${vuValue} * 0.1 * vh)`;

    return {
      windowHeight,
      pxPerVU,

      // Конверсия
      px,
      vu,

      // Предвычисленные значения в px (динамические!)
      sizes: {
        // Отступы
        gapMin: px(SIZES_VU.gap_min),
        gapBase: px(SIZES_VU.gap_base),
        gapMd: px(SIZES_VU.gap_md),
        gapLg: px(SIZES_VU.gap_lg),
        gapXl: px(SIZES_VU.gap_xl),
        gap2xl: px(SIZES_VU.gap_2xl),

        // Карточки
        cardTiny: px(SIZES_VU.card_tiny),
        cardSmall: px(SIZES_VU.card_small),
        cardNormal: px(SIZES_VU.card_normal),
        cardLarge: px(SIZES_VU.card_large),
        cardXl: px(SIZES_VU.card_xl),

        // Панели
        headerHeight: px(SIZES_VU.header_height),
        panelPadding: px(SIZES_VU.panel_padding),
        panelGap: px(SIZES_VU.panel_gap),

        // Модальные окна
        modalSm: px(SIZES_VU.modal_sm),
        modalMd: px(SIZES_VU.modal_md),
        modalLg: px(SIZES_VU.modal_lg),
        modalXl: px(SIZES_VU.modal_xl),

        // Текст
        textXs: px(SIZES_VU.text_xs),
        textSm: px(SIZES_VU.text_sm),
        textBase: px(SIZES_VU.text_base),
        textMd: px(SIZES_VU.text_md),
        textLg: px(SIZES_VU.text_lg),
        textXl: px(SIZES_VU.text_xl),
        text2xl: px(SIZES_VU.text_2xl),
        text3xl: px(SIZES_VU.text_3xl),

        // Кнопки
        btnSm: px(SIZES_VU.btn_sm),
        btnMd: px(SIZES_VU.btn_md),
        btnLg: px(SIZES_VU.btn_lg),

        // Иконки
        iconXs: px(SIZES_VU.icon_xs),
        iconSm: px(SIZES_VU.icon_sm),
        iconMd: px(SIZES_VU.icon_md),
        iconLg: px(SIZES_VU.icon_lg),

        // Игровое поле
        boardGap: px(SIZES_VU.board_gap),
        cellMin: px(SIZES_VU.cell_min),
        cellBase: px(SIZES_VU.cell_base),
        cellLarge: px(SIZES_VU.cell_large),

        // Изображения
        imageTiny: px(SIZES_VU.image_tiny),
        imageSmall: px(SIZES_VU.image_small),
        imagePreview: px(SIZES_VU.image_preview),
        imageNormal: px(SIZES_VU.image_normal),
        imageLarge: px(SIZES_VU.image_large),

        // Скроллбары
        scrollbarThin: px(SIZES_VU.scrollbar_thin),
        scrollbarNormal: px(SIZES_VU.scrollbar_normal),

        // Эффекты
        effectSm: px(SIZES_VU.effect_sm),
        effectMd: px(SIZES_VU.effect_md),
        effectLg: px(SIZES_VU.effect_lg),

        // Позиции
        posHeaderOffset: px(SIZES_VU.pos_header_offset),
        posCorner: px(SIZES_VU.pos_corner),
      },

      // CSS calc() выражения
      css: {
        // Отступы
        gapMin: calcCss(SIZES_VU.gap_min),
        gapBase: calcCss(SIZES_VU.gap_base),
        gapMd: calcCss(SIZES_VU.gap_md),
        gapLg: calcCss(SIZES_VU.gap_lg),
        gapXl: calcCss(SIZES_VU.gap_xl),
        gap2xl: calcCss(SIZES_VU.gap_2xl),

        // Размеры карточек
        cardTiny: calcCss(SIZES_VU.card_tiny),
        cardSmall: calcCss(SIZES_VU.card_small),
        cardNormal: calcCss(SIZES_VU.card_normal),
        cardLarge: calcCss(SIZES_VU.card_large),
        cardXl: calcCss(SIZES_VU.card_xl),

        // Размеры панелей
        headerHeight: calcCss(SIZES_VU.header_height),
        panelPadding: calcCss(SIZES_VU.panel_padding),
        panelGap: calcCss(SIZES_VU.panel_gap),

        // Модальные окна
        modalSm: calcCss(SIZES_VU.modal_sm),
        modalMd: calcCss(SIZES_VU.modal_md),
        modalLg: calcCss(SIZES_VU.modal_lg),
        modalXl: calcCss(SIZES_VU.modal_xl),

        // Текст
        textXs: calcCss(SIZES_VU.text_xs),
        textSm: calcCss(SIZES_VU.text_sm),
        textBase: calcCss(SIZES_VU.text_base),
        textMd: calcCss(SIZES_VU.text_md),
        textLg: calcCss(SIZES_VU.text_lg),
        textXl: calcCss(SIZES_VU.text_xl),
        text2xl: calcCss(SIZES_VU.text_2xl),
        text3xl: calcCss(SIZES_VU.text_3xl),

        // Кнопки
        btnSm: calcCss(SIZES_VU.btn_sm),
        btnMd: calcCss(SIZES_VU.btn_md),
        btnLg: calcCss(SIZES_VU.btn_lg),

        // Иконки
        iconXs: calcCss(SIZES_VU.icon_xs),
        iconSm: calcCss(SIZES_VU.icon_sm),
        iconMd: calcCss(SIZES_VU.icon_md),
        iconLg: calcCss(SIZES_VU.icon_lg),

        // Игровое поле
        boardGap: calcCss(SIZES_VU.board_gap),
        cellMin: calcCss(SIZES_VU.cell_min),
        cellBase: calcCss(SIZES_VU.cell_base),
        cellLarge: calcCss(SIZES_VU.cell_large),
      },

      // Получить размер по имени (в px)
      getSize: (size: VUSize) => {
        return px(SIZES_VU[size]);
      },

      // Получить CSS calc() выражение для размера
      getSizeCss: (size: VUSize) => {
        return calcCss(SIZES_VU[size]);
      },
    };
  }, [windowHeight]);
};

/**
 * Экспорт по умолчанию для удобства
 */
export default useVU;