# Bella Finance: збірка APK

Прототип запаковується в Android-застосунок через Capacitor. Це оболонка з WebView, у якій працює файл `www/index.html`. Інтернет для роботи не потрібен: шрифти, іконки й тема вбудовані у файл.

Що вже готово у цій папці:
- `www/index.html` один офлайн-файл застосунку (повноекранна версія без рамки телефона)
- `package.json` залежності та команди збірки
- `capacitor.config.json` назва, ідентифікатор `ua.bella.finance`, темний фон
- `.gitignore` без ключів і службових файлів

## 0. Що потрібно встановити (один раз)

1. **Node.js 18 або новіший**: https://nodejs.org (версія LTS). Перевірка: `node -v`
2. **JDK 17**: https://adoptium.net (Temurin 17). Перевірка: `java -version`
3. **Android Studio**: https://developer.android.com/studio
   - під час першого запуску дайте встановити Android SDK
   - SDK Manager, вкладка SDK Platforms: Android 14 (API 34)
   - SDK Manager, вкладка SDK Tools: Android SDK Build-Tools, Platform-Tools, Command-line Tools
4. Змінна середовища `ANDROID_HOME` (шлях до SDK). Windows: `C:\Users\<ім'я>\AppData\Local\Android\Sdk`. macOS: `~/Library/Android/sdk`. Linux: `~/Android/Sdk`.

## 1. Завантажити папку

Скачайте папку `bella-android` з проєкту на комп'ютер і відкрийте в ній термінал.

## 2. Встановити залежності й додати Android

```
npm install
npx cap add android
npx cap sync android
```

Після `cap add android` з'явиться папка `android/`. Команду `cap add android` виконують лише раз. Далі після кожної зміни `www/index.html` достатньо `npx cap sync android`.

## 3. Тестова збірка (debug APK)

Через термінал:

```
cd android
./gradlew assembleDebug
```

На Windows: `gradlew.bat assembleDebug`.

Готовий файл: `android/app/build/outputs/apk/debug/app-debug.apk`

Або через Android Studio: `npx cap open android`, потім меню Build, Build Bundle(s) / APK(s), Build APK(s).

Встановлення на телефон:
- Увімкніть на телефоні «Встановлення з невідомих джерел» (Налаштування, Безпека).
- Перекиньте `app-debug.apk` через USB, месенджер чи хмару і відкрийте його.
- Або підключіть телефон кабелем з увімкненою «Налагодження USB» і виконайте `adb install app-debug.apk`.

## 4. Іконка й заставка

1. Android Studio, правий клік на `app/res`, New, Image Asset.
2. Тип Launcher Icons (Adaptive and Legacy). Foreground: ваш логотип (PNG 1024×1024). Background Color: `#161826`.
3. Натисніть Next, потім Finish.

Заставка: фон `#161826` уже налаштований у `capacitor.config.json`. Картинку можна змінити в `android/app/src/main/res/drawable/splash.png`.

## 5. Підпис і випускна збірка (release)

Для встановлення без попереджень і для Google Play APK потрібно підписати.

1. Створіть ключ (збережіть файл і паролі, без них оновити застосунок не вийде):

```
keytool -genkey -v -keystore bella-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias bella
```

2. Покладіть `bella-release.jks` у `android/app/` і створіть файл `android/key.properties`:

```
storeFile=bella-release.jks
storePassword=ВАШ_ПАРОЛЬ
keyAlias=bella
keyPassword=ВАШ_ПАРОЛЬ
```

3. У `android/app/build.gradle` додайте на початку файлу:

```
def keystoreProps = new Properties()
def keystoreFile = rootProject.file("key.properties")
if (keystoreFile.exists()) { keystoreProps.load(new FileInputStream(keystoreFile)) }
```

і в блоці `android { ... }`:

```
signingConfigs {
    release {
        storeFile file(keystoreProps['storeFile'])
        storePassword keystoreProps['storePassword']
        keyAlias keystoreProps['keyAlias']
        keyPassword keystoreProps['keyPassword']
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
    }
}
```

(якщо `buildTypes` уже є, додайте в нього лише рядок `signingConfig signingConfigs.release`)

4. Збірка:

```
cd android
./gradlew assembleRelease
```

Файл: `android/app/build/outputs/apk/release/app-release.apk`

5. Для Google Play потрібен формат AAB: `./gradlew bundleRelease`. Файл: `android/app/build/outputs/bundle/release/app-release.aab`.

Файли `*.jks` і `key.properties` не публікуйте і не додавайте в git (вони вже в `.gitignore`).

## 6. Публікація в Google Play (за потреби)

1. Акаунт розробника: https://play.google.com/console (одноразовий внесок 25 USD).
2. Створіть застосунок, завантажте `app-release.aab`.
3. Заповніть картку: опис, скриншоти (мінімум 2), іконку 512×512, політику конфіденційності.
4. У розділі «Безпека даних» вкажіть, що дані зберігаються лише на пристрої.

## Важливо знати

- **Дані зберігаються у WebView застосунку** (localStorage). Видалення застосунку або очищення даних у налаштуваннях Android стирає їх. Резервного копіювання в хмару немає.
- **Біометрія в прототипі імітована** (натискання на кнопку відбитка). Для справжнього відбитка пальця потрібен плагін, наприклад `@aparajita/capacitor-biometric-auth`, і підключення в коді застосунку.
- **PIN-код захищає лише екран застосунку.** Файли localStorage на пристрої з root-доступом не зашифровані.
- **Курси валют** у прототипі зафіксовані (USD 41.5, EUR 46, PLN 10). Для реальних курсів потрібне підключення до API НБУ.
- **Імпорт виписки** працює офлайн, файл не залишає телефон.
- Якщо змінюєте `www/index.html`, виконайте `npx cap sync android` і зберіть APK знову.

## Типові помилки

- `JAVA_HOME is not set`: встановіть JDK 17 і задайте `JAVA_HOME` на його папку.
- `SDK location not found`: створіть `android/local.properties` з рядком `sdk.dir=ШЛЯХ_ДО_SDK`.
- `Could not resolve ...` під час збірки: потрібен інтернет під час першої збірки Gradle (завантаження залежностей).
- Білий екран після запуску: перевірте, що `www/index.html` існує, і повторіть `npx cap sync android`.

## Автоматична збірка debug APK (GitHub Actions)

У цьому репозиторії працює `.github/workflows/bella-android.yml`: Actions, «Bella Finance APK (Capacitor)», Run workflow. Готовий `app-debug.apk` буде в Artifacts запуску (`bella-finance-debug-apk`). Папка `android/` створюється під час збірки (`cap add android`), тому в git її немає.

Вміст `www/` це копія `../app/` (застосунок bella-mobile). Після змін у `app/` скопіюйте файли в `www/` і збільште версію кешу в `www/sw.js`.
