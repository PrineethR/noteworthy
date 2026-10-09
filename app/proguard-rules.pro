# R8 / ProGuard rules for Noteworthy Release

-keepattributes *Annotation*,InnerClasses
-dontnote kotlinx.serialization.SerializationKt
-keepclassmembers class * {
    *** Companion;
}
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}

# Room
-keep class * extends androidx.room.RoomDatabase

# Hilt
-keep class * extends dagger.hilt.internal.GeneratedComponent
