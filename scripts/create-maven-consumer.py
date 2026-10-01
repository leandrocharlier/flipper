"""Generate a disposable, synthetic Maven consumer under ignored work/."""
import argparse
import re
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--version', default='1.0.0')
parser.add_argument('--central-only', action='store_true')
parser.add_argument('--integration-tests', action='store_true', help='Include synthetic device tests for the published modules')
args = parser.parse_args()
if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*', args.version):
    parser.error('Expected a Maven release version')
root = Path(__file__).resolve().parents[1]
target = root/'work/maven-consumer'
target.mkdir(parents=True, exist_ok=True)
fixtures = root/'scripts/fixtures/maven-consumer'
if not args.integration_tests:
    # A later basic generation must not retain the integration-only manifest or sources.
    # Remove only files owned by this generator; never clear the consumer directory.
    for source in (fixtures/'src').rglob('*'):
        if source.is_file():
            generated = target/'src'/source.relative_to(fixtures/'src')
            assert generated.resolve().is_relative_to(target.resolve())
            if generated.is_file():
                generated.unlink()
repository = '' if args.central_only else "maven { url = uri('../maven-repository'); content { includeGroup('io.github.leandrocharlier.flipper') } }"
(target/'settings.gradle').write_text("""pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { %s; google(); mavenCentral() }
}
rootProject.name = 'synthetic-maven-consumer'
""" % repository, encoding='utf-8')
plugins = ['flipper', 'flipper-network-plugin', 'flipper-litho-plugin',
           'flipper-leakcanary-plugin', 'flipper-leakcanary2-plugin',
           'flipper-retrofit2-protobuf-plugin', 'flipper-jetpack-compose-plugin',
           'flipper-imagepipeline-native', 'flipper-nativeimagefilters', 'flipper-nativeimagetranscoder']
deps = '\n'.join(f"    debugImplementation 'io.github.leandrocharlier.flipper:{name}:{args.version}'" for name in plugins)
(target/'build.gradle').write_text("""plugins { id 'com.android.application' version '8.2.2'; %s }
android {
    namespace 'com.example.flipper.mavenvalidation'
    compileSdk 34
    defaultConfig { applicationId 'com.example.flipper.mavenvalidation'; minSdk 21; targetSdk 34; versionCode 1; versionName '1.0' }
    compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }
    packagingOptions { jniLibs.useLegacyPackaging = true }
}
dependencies {
%s
    releaseImplementation 'io.github.leandrocharlier.flipper:flipper-noop:%s'
}
ext.localSigningName = 'sample'
ext.localSigningRepositoryRoot = file('../..')
apply from: new File(localSigningRepositoryRoot, 'android/local-app-signing.gradle')

tasks.register('verifyPublishedDependencyGraph') {
    doLast {
        configurations.debugRuntimeClasspath.resolvedConfiguration.resolvedArtifacts.each { artifact ->
            def id = artifact.moduleVersion.id
            if (id.group == 'local.flipper' || id.group == 'com.facebook.flipper' ||
                (id.group in ['com.facebook.yoga', 'com.facebook.litho', 'com.facebook.fresco'] &&
                 id.name in ['yoga', 'litho-flexlayout', 'imagepipeline-native', 'nativeimagefilters', 'nativeimagetranscoder'])) {
                throw new GradleException('Unexpected upstream/local artifact: ' + id)
            }
        }
        println 'PASS: all plugins resolved without local or upstream Flipper/native replacements'
    }
}
""" % ("id 'org.jetbrains.kotlin.android' version '1.9.23'" if args.integration_tests else '', deps, args.version), encoding='utf-8')
(target/'gradle.properties').write_text('android.useAndroidX=true\nandroid.enableJetifier=true\nkotlin.stdlib.default.dependency=false\norg.gradle.jvmargs=-Xmx2g\n', encoding='utf-8')
main = target/'src/main'
java = main/'java/com/example/flipper/mavenvalidation'
java.mkdir(parents=True, exist_ok=True)
(main/'AndroidManifest.xml').write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-permission android:name="android.permission.INTERNET"/><application android:theme="@android:style/Theme.Material.Light.NoActionBar" android:label="Synthetic Maven validation"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>''', encoding='utf-8')
(java/'MainActivity.java').write_text('''package com.example.flipper.mavenvalidation;
public class MainActivity extends android.app.Activity {
  @Override public void onCreate(android.os.Bundle state) {
    super.onCreate(state);
    android.widget.TextView text = new android.widget.TextView(this);
    try {
      // Both the actual SDK and its release no-op must expose the same API.
      try {
        Class.forName("com.facebook.soloader.SoLoader").getMethod("init", android.content.Context.class, boolean.class).invoke(null, this, false);
      } catch (ClassNotFoundException noOpBuild) { }
      com.facebook.flipper.core.FlipperClient client = com.facebook.flipper.android.AndroidFlipperClient.getInstance(this);
      client.start();
      text.setText("Synthetic Maven SDK started");
      android.util.Log.i("MavenValidation", "Synthetic Maven SDK started");
    } catch (Throwable error) {
      text.setText("SDK failed: " + error.getClass().getSimpleName());
      android.util.Log.e("MavenValidation", "Synthetic SDK failed", error);
    }
    setContentView(text);
  }
}
''', encoding='utf-8')
print('Generated synthetic consumer; repositories: ' + ('Google and Maven Central only' if args.central_only else 'isolated staged repository, Google and Maven Central'))
if args.integration_tests:
    shutil.copytree(fixtures/'src', target/'src', dirs_exist_ok=True)
    with (target/'build.gradle').open('a', encoding='utf-8') as output:
        output.write("\napply from: '../../scripts/fixtures/maven-consumer/integration.gradle'\n")
    print('Included synthetic integration tests; no captures or private configuration are copied')
