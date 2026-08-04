# Plush Lesson Plan 3D

Проект процедурной 3D-реконструкции плюшевой типографики из референса:
`Teachers: How to create a lesson plan in 30 seconds`.

## GitHub Pages

Публичный интерактивный preview: 
`https://vostroslava.github.io/plush-lesson-plan-3d/`.

- [главная 3D-сцена](https://vostroslava.github.io/plush-lesson-plan-3d/)
- [плюшевый алфавит](https://vostroslava.github.io/plush-lesson-plan-3d/alphabet.html?page=letters)
- [цифры](https://vostroslava.github.io/plush-lesson-plan-3d/alphabet.html?page=numbers)
- [знаки](https://vostroslava.github.io/plush-lesson-plan-3d/alphabet.html?page=symbols)
- [overlay поверх видео](https://vostroslava.github.io/plush-lesson-plan-3d/overlay.html?debug=1)

Pages публикуется из папки `docs` ветки `main`. Чтобы обновить preview после
изменений, выполните `VITE_BASE=/plush-lesson-plan-3d/ npm run build`, затем
скопируйте содержимое `dist/` в `docs/` и отправьте изменения в `main`.

## Назначение

Собрать объёмные мягкие буквы и подготовить их для рекламной сцены с
анимацией, столкновениями, перестроением и взаимодействием с логотипом AID.

## Входные данные

- `references/plush-lesson-plan-reference.png` — источник истины для формы,
  раскладки, палитры и деталей ткани.

## Результаты

- процедурная Three.js-модель букв;
- action-ready иерархия с отдельными буквами/строками;
- контрольные рендеры и сравнение с референсом в `review/`;
- финальные ассеты в `delivery/`.

## Основные папки

- `references/` — исходные изображения;
- `source/` — локальная проверенная копия видео без субтитров;
- `src/` — процедурная геометрия и материалы;
- `work/overlay/` — прозрачные overlay-кадры и cap-скрипт;
- `work/benchmark/` — отдельный GPU capture benchmark, cold/warm JSON/Markdown и
  run-specific MP4;
- `alphabet.html` + `src/alphabet.js` — горизонтальная библиотека
  переиспользуемых букв, цифр и production-знаков;
- `phone.html` + `src/phone.js` — редактируемый мобильный экран Aidemia,
  подготовленный для вставки в green-screen phone footage;
- `review/` — скриншоты и решения по QA;
- `delivery/` — подтверждённые экспортируемые результаты;
- `.img2threejs/` — состояние quality-gated пайплайна.

## Источник правды

Для визуальной реконструкции — `references/plush-lesson-plan-reference.png`;
для этапов и ограничений сборки — `.img2threejs/state.json` и
`object-sculpt-spec.json`.

## Проверка

На каждом pass нужно пройти локальный state gate, собрать preview, проверить
фронтальный силуэт, толщину, швы/ворс и минимум два 3D-ракурса.

## Индивидуальная физика букв

Каждый `glyph.*` получает собственный Rapier rigid body и cuboid collider,
синхронизированный с отдельным визуальным pivot. В preview доступны кнопки
`Drop letters` и `Reset`; клик по букве прикладывает импульс только к ней.

Для автоматического запуска физики откройте URL с `?physics=1`. Runtime API:

- `window.plushTypography.list` — список всех 42 glyph-узлов;
- `window.plushTypography.getGlyph(id)` — визуальный pivot конкретной буквы;
- `window.plushTypography.impulse(id, {x, y, z})` — импульс конкретной букве;
- `window.plushTypography.drop()` / `.reset()` — запустить или восстановить композицию.

## Hook поверх видео

Исходник без субтитров находится в
`source/EID-1978_Lesson-Plans-Monday-no-subtitles.mp4`.
Overlay-страница использует те же 42 glyph-объекта, но раскладывает наш текст
для вертикального кадра как `TEACHERS:` сверху и три строки ниже:
`HOW TO CREATE A`, `LESSON PLAN`, `IN 30 SECONDS`.

- интерактивный preview: `http://127.0.0.1:5174/overlay.html?debug=1`;
- быстрый draft: `delivery/lesson-plan-30s-plush-hook-preview.mp4`;
- основной preview: `delivery/lesson-plan-30s-plush-hook-preview-1080x1920-6s.mp4`;
- основной cap: 180 уникальных кадров, 1080x1920, 30 fps, 6 секунд;
- каждый glyph в overlay имеет отдельный Rapier body, pointer-импульс и
  выраженные extrusion/bevel-боковины плюс spring squash/stretch shell на
  прилёте;
- для капчей используется прозрачный Three.js-слой, который затем
  синхронно накладывается на оригинальное видео через ffmpeg.

## GPU benchmark preview

Отдельный маршрут `http://127.0.0.1:5174/benchmark.html` собирает фон как
`THREE.VideoTexture` в том же WebGL canvas, а 42 буквы — как объёмные Three.js
меши с Rapier-физикой на fixed timestep 60 Hz. Экспорт использует
`canvas.captureStream(30)` + MediaRecorder; PNG/readback не является export-путём.

- GPU delivery:
  `delivery/lesson-plan-30s-plush-hook-preview-gpu-metal-1080x1920-6s.mp4`;
- benchmark report:
  `work/benchmark/benchmark-report.json` и `work/benchmark/benchmark-report.md`;
- renderer QA: `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified
  Version)`; SwiftShader/software fallback отклоняется;
- output QA: H.264 через `h264_videotoolbox`, 1080x1920, 30 fps, 6.000 s,
  180 unique decoded frames, AAC 48 kHz stereo;
- baseline comparison: `baseline-png-readback` в run-папке отчёта, с cold и
  warm прогонами тех же 1080x1920 / 6 s / 30 fps параметров.

## Plush glyph library

Одна и та же фабрика расширена до reusable-набора с тремя wide-страницами:

- `http://127.0.0.1:5174/alphabet.html?page=letters` — A–Z;
- `http://127.0.0.1:5174/alphabet.html?page=numbers` — 0–9;
- `http://127.0.0.1:5174/alphabet.html?page=symbols` — `.,!?;:()[]{}+-=/%&@#*`.

Каждый glyph остаётся отдельным объектом. Hero-detail профиль использует
512px procedural albedo/bump/roughness maps, 28 curve segments, 12 bevel
segments, объёмный seam-back, raised 3D piping/stitches и fringe-ворс по краю.
В интерфейсе можно отдельно менять цвет, размер и толщину, применять цвет ко
всему набору, включать новую палитру и проверять физику.

Runtime API:

- `window.plushAlphabet.list` — список glyph id и символов текущей страницы;
- `.getLetter(character)` — отдельный pivot буквы/цифры/знака;
- `.setColor(character, color)` / `.setAllColor(color)`;
- `.setScale(character, value)` / `.setDepth(character, value)`;
- `.setSoftness(character, value)` — spring-based squash/stretch compliance;
- `.setBounce(character, value)` — per-glyph Rapier restitution;
- `.squish(character, strength)` / `.impactWave(character, strength)` — local
  compression or a deterministic neighbor ripple;
- `.toggleWind()` / `.showcase()` — fiber-breeze motion and a tactile sequence;
- `.assemble(text)` — magnetic staggered assembly from the existing glyph set;
- `.drop()` / `.reset()` / `.impulse(id, impulse)`.

The physical layer is intentionally hybrid: each letter has its own rigid
Rapier proxy for collisions, while the visible plush shell has an independent
spring squash/stretch layer with a GPU vertex bend and front-surface dimple.
This keeps the motion stable and editable while making impacts, landings,
magnetic assembly and neighbor waves readable in a render. Repeated letters in
an assembled word receive a temporary visual copy of the same existing glyph;
Reset removes copies and restores the complete source grid.

## Phone product proof

Страница `https://aidemia.co/app.php?auloid=1735701386-97950` проверена в
headless browser: она открывает мобильный форум Aidemia, а ответ содержит
`X-Frame-Options: SAMEORIGIN`. Поэтому прямой `iframe` из localhost не является
источником для видео. Вместо этого `phone.html` содержит контролируемую
локальную реконструкцию нужного экрана: реальные мобильные паттерны шапки и
нижней навигации Aidemia, плюс редактируемую форму `Create a lesson plan`.

- экран-источник: `http://127.0.0.1:5174/phone.html`;
- чистый экран для захвата: `http://127.0.0.1:5174/phone.html?screen=1`;
- reference-снимок реального mobile view: `references/aidemia-mobile-reference.png`;
- DOM-снимок, используемый в рендере: `work/phone/screen-design-from-dom.png`;
- для вариантов копирайта: `PHONE_TOPIC="..." PHONE_GRADE="..." PHONE_TIME="..." work/phone/render-phone-preview.sh`;
- трекинг плоскости дисплея: `work/phone/track-screen.py`;
- воспроизводимый render script: `work/phone/render-phone-preview.sh`;
- прозрачный мастер для дальнейшей компоновки:
  `delivery/phone/iphone-aidemia-screen-alpha-6s.mov`;
- six-second viewing preview:
  `delivery/phone/iphone-aidemia-screen-preview-6s.mp4`;
- review: `review/phone/iphone-aidemia-screen-3s.png` и
  `review/phone/iphone-aidemia-screen-contact.jpg`.

Источник телефона — ProRes 4444 1920×1080, 30 fps, 10 секунд, без аудиотрека.
В первом deliverable используется фронтальная часть исходника на 6 секунд:
зелёная display-plane отслеживается покадрово, а при уходе телефона в профиль
экран сжимается и исчезает вместе с плоскостью. Это сохраняет ощущение объёма
и оставляет прозрачный ProRes для последующей вставки в рекламу.
