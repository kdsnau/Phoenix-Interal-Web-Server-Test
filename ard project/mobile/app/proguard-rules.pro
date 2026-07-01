# Keep kotlinx.serialization metadata for our @Serializable models.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keep,includedescriptorclasses class com.phoenixsectech.door.data.**$$serializer { *; }
-keepclassmembers class com.phoenixsectech.door.data.** {
    *** Companion;
}
-keepclasseswithmembers class com.phoenixsectech.door.data.** {
    kotlinx.serialization.KSerializer serializer(...);
}
