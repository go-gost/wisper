plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "run.gost.wisper"
    compileSdk = 34

    defaultConfig {
        applicationId = "run.gost.wisper"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        // CI-generated keystore for GitHub Releases.
        // When the keystore file is absent, fall back to debug signing so local
        // `assembleDebug` still works; `assembleRelease` will fail with a clear
        // "keystore not found" error — generate one with:
        //   keytool -genkeypair -keystore android/release.keystore \
        //     -alias wisper -keyalg RSA -keysize 2048 -validity 10000 \
        //     -storepass android -keypass android \
        //     -dname "CN=Wisper, OU=Dev, O=go-gost"
        create("release") {
            storeFile = rootProject.file("release.keystore")
            storePassword = "android"
            keyAlias = "wisper"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
        debug {
            // Ensure debug APK is used for connectedCheck
            isDebuggable = true
        }
    }

    testBuildType = "debug"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")

    // ── Instrumentation tests ──────────────────────────────────────────
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.2.0")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:rules:1.5.0")
}
