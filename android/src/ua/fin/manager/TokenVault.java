package ua.fin.manager;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Шифрує refresh token ключем з Android Keystore: на диску лежить лише шифротекст, ключ не виходить із системи. */
final class TokenVault {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "fin_refresh_token";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private TokenVault() {}

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
            kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build());
            return kg.generateKey();
        }
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    /** Повертає рядок "iv:шифротекст" (base64) або null, якщо шифрування не вдалося. */
    static String encrypt(String plain) {
        try {
            Cipher c = Cipher.getInstance(TRANSFORMATION);
            c.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return Base64.encodeToString(c.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    /** Розшифровує значення з encrypt(); повертає null, якщо значення відсутнє, пошкоджене або без шифрування. */
    static String decrypt(String stored) {
        if (stored == null) return null;
        try {
            int sep = stored.indexOf(':');
            Cipher c = Cipher.getInstance(TRANSFORMATION);
            c.init(Cipher.DECRYPT_MODE, key(),
                    new GCMParameterSpec(128, Base64.decode(stored.substring(0, sep), Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(stored.substring(sep + 1), Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
