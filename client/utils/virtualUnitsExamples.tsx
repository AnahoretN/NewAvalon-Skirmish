/**
 * Примеры использования системы виртуальных единиц измерения
 * Этот файл демонстрирует различные паттерны использования VU в компонентах
 */

import { useVU } from '@/hooks/useVirtualUnits';

/**
 * ПРИМЕР 1: Базовое использование в функциональном компоненте
 */
export const ExampleComponent1 = () => {
  const { sizes, styles } = useVU();

  return (
    <div
      style={{
        padding: sizes.gapBase,      // 8px
        margin: sizes.gapMd,         // 12px
        width: sizes.cardNormal,     // 128px
        height: sizes.cardNormal,    // 128px
      }}
    >
      Card content
    </div>
  );
};

/**
 * ПРИМЕР 2: Использование с масштабированием
 */
export const ExampleComponent2 = () => {
  const { sizes } = useVU(1.5); // Все размеры в 1.5 раза больше

  return (
    <div
      style={{
        width: sizes.cardNormal,     // 192px (128px * 1.5)
        height: sizes.cardNormal,    // 192px
        padding: sizes.panelPadding, // 18px (12px * 1.5)
      }}
    >
      Scaled content
    </div>
  );
};

/**
 * ПРИМЕР 3: Адаптивный компонент
 * Примечание: useResponsiveVU пока не реализован
 */
export const ExampleComponent3 = () => {
  const { sizes } = useVU(); // Используем обычный useVU

  return (
    <div
      style={{
        width: sizes.modalLg,      // 400px
        padding: sizes.gapLg,      // 16px
      }}
    >
      Responsive content
    </div>
  );
};

/**
 * ПРИМЕР 4: Конверсия существующих размеров
 */
export const ExampleComponent4 = () => {
  const { px, vu } = useVU();

  // Конвертируем VU в px
  const cardSize = px(16); // 128px

  // Конвертируем px в VU
  const existingSize = vu(100); // 12.5 vu

  return (
    <div style={{ width: cardSize }}>
      Converted sizes
    </div>
  );
};

/**
 * ПРИМЕР 5: Использование с именованными размерами
 */
export const ExampleComponent5 = () => {
  const { getSize, getSizeCss } = useVU();

  return (
    <div
      style={{
        width: getSize('card_normal'),      // 128px
        height: getSize('card_normal'),     // 128px
        fontSize: getSize('text_base'),     // 8px
        padding: getSize('gap_lg'),         // 16px
      }}
    >
      Named sizes
    </div>
  );
};

/**
 * ПРИМЕР 6: Миграция существующего кода
 *
 * БЫЛО:
 * ```tsx
 * <div className="w-32 h-32 p-2">  // 128px x 128px, 8px padding
 *   Content
 * </div>
 * ```
 *
 * СТАЛО:
 * ```tsx
 * const { sizes } = useVU();
 *
 * <div style={{ width: sizes.cardNormal, height: sizes.cardNormal, padding: sizes.gapBase }}>
 *   Content
 * </div>
 * ```
 */
export const ExampleMigration = () => {
  const { sizes } = useVU();

  return (
    <div
      style={{
        width: sizes.cardNormal,    // было: w-32 (128px)
        height: sizes.cardNormal,   // было: h-32 (128px)
        padding: sizes.gapBase,     // было: p-2 (8px)
      }}
    >
      Migrated content
    </div>
  );
};

/**
 * ПРИМЕР 7: Сложный компонент с множественными размерами
 */
export const ExampleComplexComponent = () => {
  const { sizes, styles } = useVU();

  return (
    <div
      style={{
        width: sizes.modalLg,
        padding: sizes.panelPadding,
        borderRadius: sizes.gapMd,
      }}
    >
      {/* Header */}
      <div
        style={{
          height: sizes.headerHeight,
          marginBottom: sizes.gapBase,
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${sizes.gapMd}px`,
        }}
      >
        <h2 style={{ fontSize: sizes.textXl }}>Header</h2>
      </div>

      {/* Content */}
      <div
        style={{
          padding: sizes.gapBase,
          display: 'grid',
          gap: sizes.gapMd,
          gridTemplateColumns: `repeat(auto-fill, minmax(${sizes.cardSmall}px, 1fr))`,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              ...styles.cardSmall, // width и height из предвычисленных стилей
              backgroundColor: '#333',
            }}
          >
            Card {i}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: sizes.gapLg,
          padding: `${sizes.gapMd}px ${sizes.gapBase}px`,
          display: 'flex',
          gap: sizes.gapBase,
          justifyContent: 'flex-end',
        }}
      >
        <button
          style={{
            padding: `${sizes.gapMd}px ${sizes.gapLg}px`,
            fontSize: sizes.textBase,
          }}
        >
          Cancel
        </button>
        <button
          style={{
            padding: `${sizes.gapMd}px ${sizes.gapLg}px`,
            fontSize: sizes.textBase,
          }}
        >
          Confirm
        </button>
      </div>
    </div>
  );
};

/**
 * ПРИМЕР 8: Игровое поле с ячейками
 */
export const ExampleGameBoard = () => {
  const { sizes } = useVU();
  const gridSize = 4; // 4x4 grid

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridSize}, ${sizes.cellBase}px)`,
        gap: sizes.boardGap,
        padding: sizes.gapLg,
      }}
    >
      {Array.from({ length: gridSize * gridSize }).map((_, i) => (
        <div
          key={i}
          style={{
            width: sizes.cellBase,    // 112px
            height: sizes.cellBase,   // 112px
            backgroundColor: '#222',
            border: '1px solid #444',
          }}
        >
          Cell {i + 1}
        </div>
      ))}
    </div>
  );
};

/**
 * ПРИМЕР 9: Карточка с элементами
 */
export const ExampleCard = () => {
  const { sizes } = useVU();

  return (
    <div
      style={{
        ...sizes.styles.cardNormal, // width: 128px, height: 128px
        position: 'relative',
        backgroundColor: '#2a2a2a',
        borderRadius: sizes.gapMd,
        overflow: 'hidden',
      }}
    >
      {/* Иконка силы */}
      <div
        style={{
          position: 'absolute',
          bottom: sizes.gapBase,
          right: sizes.gapBase,
          width: sizes.btnLg,     // 32px
          height: sizes.btnLg,    // 32px
          backgroundColor: '#3b82f6',
          borderRadius: sizes.gapBase,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: sizes.textLg,
          fontWeight: 'bold',
        }}
      >
        5
      </div>

      {/* Статус иконки */}
      <div
        style={{
          position: 'absolute',
          bottom: sizes.gapBase,
          left: sizes.gapBase,
          right: sizes.btnLg,
          display: 'flex',
          flexWrap: 'wrap',
          gap: sizes.effectSm,
        }}
      >
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              width: sizes.iconMd,   // 16px
              height: sizes.iconMd,  // 16px
              backgroundColor: '#10b981',
              borderRadius: '50%',
            }}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * ПРИМЕР 10: Модальное окно
 */
export const ExampleModal = () => {
  const { sizes } = useVU();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: sizes.gapLg,
      }}
    >
      <div
        style={{
          width: sizes.modalLg,           // 400px
          maxHeight: '80vh',
          backgroundColor: '#1f2937',
          borderRadius: sizes.gapLg,      // 16px
          padding: sizes.panelPadding,    // 12px
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            marginBottom: sizes.gapBase,
            paddingBottom: sizes.gapBase,
            borderBottom: '1px solid #374151',
          }}
        >
          <h2 style={{ fontSize: sizes.text2xl, margin: 0 }}>
            Modal Title
          </h2>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: `${sizes.gapBase}px 0`,
            fontSize: sizes.textBase,
          }}
        >
          Modal content goes here...
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: sizes.gapBase,
            paddingTop: sizes.gapBase,
            borderTop: '1px solid #374151',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: sizes.gapBase,
          }}
        >
          <button
            style={{
              padding: `${sizes.gapMd}px ${sizes.gapLg}px`,
              fontSize: sizes.textBase,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};