# Bolm Motion — تحليل الريبوين + المواصفات التقنية (المرحلة 2)

**التاريخ:** 2026-11-02 · **الحالة:** بناء بدأ · **المرجع الوظيفي:** تقرير تحليل Alight Motion v1.1 (6.2.60)

---

## الجزء 1 — تحليل المشروعين مفتوحي المصدر

### 1.1 Open-Motion (Hada45) — github.com/Hada45/Open-Motion

| البند | النتيجة |
|---|---|
| الترخيص | **MIT** (© 2026 Hada45) — إعادة الاستعمال مسموحة مع نسبة المصدر |
| الشكل | تطبيق ويب **ملف واحد**: `index.html` بحجم 11.9MB / ‏60,423 سطراً (HTML+CSS+JS مضمّنة) + `sw.js` (PWA) |
| التقنية | Vanilla JS + Canvas 2D + لمسات WebGL + Browser Media APIs — **لا FFmpeg** (التصدير بقدرات المتصفح) |
| الحالة | **Prototype / WIP** — صاحبُه نفسه يصرّح: غير جاهز للإنتاج، الصيغ والواجهات تتغير |
| الأنظمة القوية | Keyframes بمنحنيات (Curve & Easing Editor)، تحرير مسارات Vector (نقاط Bézier)، **3D Transform + سير عمل كاميرا**، طبقات وتايملاين موجَّه للموبايل أولاً |
| الحجم الدلالي | ~1,652 دالة؛ «camera» ×1,023 وروداً، «keyframe» ×572، «bezier/curve» ×376 — الكاميرا والمنحنيات قلب المشروع فعلاً، لا زخرفة تسويقية |

**الحكم الهندسي:** مرجع ممتاز لتصميم **محرر المنحنيات** ومنطق **التحويل ثلاثي الأبعاد/الكاميرا**، لكن بنيته (ملف واحد 60k سطر، موبايل أولاً، بروتوتايب) تجعله غير صالح أساساً لمنتج ويندوز احترافي. **نستلهم ونقتطع مفاهيم، لا نفترع الكود.**

### 1.2 Motionity (Alyssa X) — github.com/alyssaxuu/motionity

| البند | النتيجة |
|---|---|
| الترخيص | **MIT** (© 2022 Alyssa X) — إعادة الاستعمال مسموحة مع نسبة المصدر |
| الشكل | تطبيق ويب بلا خطوة بناء: `src/index.html` + وحدات JS (~10,900 سطر كود أصلي: functions.js ‏5,971 · ui.js ‏2,369 · init.js ‏1,075 · events.js ‏1,022 · recorder.js · converter.js) |
| التقنية | **Fabric.js** (محرك كانفس كائني: تحديد/تحويل/تجميع) + **Anime.js** (محرك Tween للـ Keyframes مع Easing مخصص) + **ffmpeg.wasm** (تصدير) + MediaRecorder/webm-writer + Localbase/IndexedDB (حفظ المشاريع) + Pickr/Sortable |
| الميزات | Keyframing بـ Easing مخصص، فلاتر صورة/فيديو (تعديلات، Blur، Chroma Key)، قصّ فيديو، أقنعة طبقات، صوت، أنيميشن نصوص، Lottie، بحث أصول (Pixabay) |
| الحالة | منتج ويب حيّ (motionity.app) منذ 2022 — **ناضج ومستعمل فعلياً**، لكنه بلا كاميرا، وبلا Graph Editor (الـ Easing منحنيات جاهزة/مخصصة بقيم، لا محرر منحنى كامل)، وبنية jQuery-عصرها مترابطة |

**الحكم الهندسي:** إثبات حيّ أن معادلة **Fabric.js + محرك Keyframes + ffmpeg** تصنع محرر موشن حقيقياً في المتصفح. **نأخذ المكتبات نفسها (وهي مفتوحة بذاتها) والدرس المعماري، ونكتب منطق المحرر بأنفسنا** بواجهة ويندوز احترافية ونظام كاميرا لا يملكه أيٌّ من المشروعين.

### 1.3 جدول المقارنة والقرار

| المحور | Open-Motion | Motionity | **قرار Bolm Motion** |
|---|---|---|---|
| الترخيص | MIT | MIT | استعمال قانوني للمكتبات والمفاهيم مع النسبة في THIRD-PARTY |
| محرك الرسم | Canvas/WebGL يدوي | **Fabric.js** | **Fabric.js** (تحديد، مقابض، تجميع — جاهز وناضج) |
| محرك الحركة | داخلي + Curve Editor | Anime.js Tweens | **محرك Keyframes خاص بنا** (مسارات لكل خاصية + حلّال Cubic-Bézier) مستلهم من الاثنين |
| الكاميرا | 3D Transform/Camera (بروتوتايب) | لا توجد | **كاميرا كاملة من عندنا** (X/Y/Z + FOV + Parallax + DoF/Fog) — نقطة التفوق |
| التصدير | MediaRecorder | ffmpeg.wasm | **FFmpeg محلي عبر Electron** (أسرع وأقوى من wasm) — مرحلة لاحقة |
| المنصة | ويب/موبايل | ويب | **Electron → ويندوز .exe** (سلسلة بناء Bolm المجرّبة) |
| Graph Editor | Curve Editor أساسي | لا | **Graph Editor كامل** — مرحلة متقدمة مخططة |

---

## الجزء 2 — المواصفات التقنية لمنتجنا

### 2.1 المكدّس (Stack)
- **Electron 45** (Chromium 156) — نفس إصدار Bolm Browser، سلسلة بناء/NSIS/توقيع مجرّبة على ويندوز المستخدم.
- **Fabric.js 5.3.1** لكانفس المعاينة (كائنات، تحديد، مقابض تحويل).
- **Vanilla JS** في الـ Renderer (بلا إطار عمل — خفيف وقابل للتحكم الكامل)، CSS مخصص بهوية Bolm (بنفسجي زجاجي، داكن).
- التصدير لاحقاً: FFmpeg binary يُستدعى من الـ Main Process.

### 2.2 نموذج البيانات (Project Model) — قلب النظام
```jsonc
Project {
  name, width, height, fps, duration, background,
  layers: [ Layer ], activeCameraId
}
Layer {
  id, name, type: shape|text|image|video|audio|camera|null|group,
  start, duration, visible, locked, parentId, depth /* Z */,
  props: { x, y, scaleX, scaleY, rotation, opacity, anchorX, anchorY },
  tracks: { [prop]: [ { t, v, ease: [x1,y1,x2,y2] } ] },  // keyframes
  text?, fill?, src?, points?
}
```
- كل خاصية رقمية تُقيَّم عند الزمن t ببحث ثنائي بين Keyframeين + حلّال Cubic-Bézier للـ Easing.
- **الكاميرا طبقة**: props ‏(x, y, z, fov) + tracks مثل أي طبقة؛ عند العرض تُطبَّق إسقاطاتها على كل طبقة حسب **عمقها Z**: الإزاحة الظاهرية = إزاحة الكاميرا × عامل العمق، والقياس الظاهري = ‏f(z_cam, z_layer, fov) — Parallax رياضي حقيقي.

### 2.3 خطة المراحل (ببوابات موافقة كقواعدك)
- **M0 (اليوم):** هيكل Electron + نواة: نموذج مشروع، طبقات (شكل/نص/صورة)، تايملاين (مسطرة/أشرطة/معينات Keyframes/رأس تشغيل)، تقييم حركة + Easing، لوحة خصائص بأزرار Keyframe، كاميرا v1 (Pan/Zoom + Parallax بالعمق)، حفظ/فتح JSON. **إثبات: سكرين شوت من التطبيق يعمل.**
- **M1:** Graph Editor + نسخ/لصق Keyframes + Parenting/Null كامل + تجميع.
- **M2:** التأثيرات (أول 25 من قائمة Alight الموثقة الـ186) + Blending كامل + أقنعة.
- **M3:** كاميرا v2 (DoF آلي + Fog + Presets حركات) + عناصر/قوالب JSON.
- **M4:** تصدير FFmpeg (MP4/GIF/PNG Seq/WebM) + بناء .exe ونشر GitHub كما في المتصفح.

### 2.4 ما لا نعد به
تطابقاً حرفياً مع Alight ولا اكتمال الـ186 تأثيراً دفعة واحدة ولا أداءً بلا اختبار على ويندوزك — كل مرحلة تُثبت عملياً قبل الانتقال.
