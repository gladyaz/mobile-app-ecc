const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');

const UNVERSIONED_CLASSPATH = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')";

// The 2.2.x compiler needs more Metaspace than the template's 512m: with the
// full module graph plus lint, the Gradle daemon dies mid-build on
// "Metaspace" (seen on lintVitalAnalyzeRelease) once the bigger Kotlin
// classloaders are resident. Raised as part of the same change that raised
// Kotlin, because one causes the other.
const JVM_ARGS = '-Xmx2048m -XX:MaxMetaspaceSize=1024m';

/**
 * Pins the ROOT buildscript's kotlin-gradle-plugin to an explicit version.
 *
 * Why this exists: the Expo template leaves that classpath entry unversioned,
 * so Gradle resolves it from react-native-gradle-plugin's transitive pin
 * (2.1.20) - and because a subproject's buildscript classloader inherits the
 * root's, that 2.1.x compiler shadows every other request, including
 * react-native-google-mobile-ads asking for `rootProject.ext.kotlinVersion`.
 * play-services-ads 25.x ships Kotlin 2.3.0 metadata, which a 2.1.x compiler
 * cannot read ("Module was compiled with an incompatible version of Kotlin"),
 * so every Android release build died in :react-native-google-mobile-ads.
 * `expo-build-properties`' android.kotlinVersion alone cannot fix this: it
 * feeds the version catalog and ext, never the root classpath that actually
 * wins. Keep the version here aligned with the one in app.json's
 * expo-build-properties entry so ext and the real compiler agree.
 */
module.exports = function withRootKotlinGradlePlugin(config, { version }) {
  if (!version) {
    throw new Error('with-root-kotlin-gradle-plugin: a { version } prop is required.');
  }

  config = withGradleProperties(config, (propertiesConfig) => {
    const jvmArgsProperty = propertiesConfig.modResults.find(
      (property) => property.type === 'property' && property.key === 'org.gradle.jvmargs'
    );

    if (jvmArgsProperty) {
      jvmArgsProperty.value = JVM_ARGS;
    } else {
      propertiesConfig.modResults.push({
        type: 'property',
        key: 'org.gradle.jvmargs',
        value: JVM_ARGS,
      });
    }

    return propertiesConfig;
  });

  return withProjectBuildGradle(config, (gradleConfig) => {
    const contents = gradleConfig.modResults.contents;

    if (!contents.includes(UNVERSIONED_CLASSPATH)) {
      throw new Error(
        'with-root-kotlin-gradle-plugin: could not find the unversioned ' +
          "kotlin-gradle-plugin classpath entry in android/build.gradle. The Expo " +
          'template may have changed - re-check whether this pin is still needed.'
      );
    }

    gradleConfig.modResults.contents = contents.replace(
      UNVERSIONED_CLASSPATH,
      `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:${version}')`
    );

    return gradleConfig;
  });
};
