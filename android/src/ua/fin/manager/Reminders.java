package ua.fin.manager;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/** Планує локальні нагадування (погашення ОВДП, копія JSON). Час задає сторінка, тут лише будильники. */
final class Reminders {
    static final String CHANNEL = "reminders";
    private static final String PREFS = "reminders";

    private Reminders() {}

    static void channel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Нагадування", NotificationManager.IMPORTANCE_DEFAULT));
        }
    }

    private static PendingIntent pi(Context c, int id, String title, String text) {
        Intent i = new Intent(c, ReminderReceiver.class).putExtra("id", id).putExtra("title", title).putExtra("text", text);
        return PendingIntent.getBroadcast(c, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** json: [{"id":1,"at":1700000000000,"title":"…","text":"…"}]. Старі будильники скасовуються. */
    static void schedule(Context c, String json) {
        try {
            SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            AlarmManager am = c.getSystemService(AlarmManager.class);
            JSONArray old = new JSONArray(p.getString("list", "[]"));
            for (int k = 0; k < old.length(); k++) {
                JSONObject o = old.getJSONObject(k);
                am.cancel(pi(c, o.getInt("id"), "", ""));
            }
            JSONArray now = new JSONArray(json);
            long t = System.currentTimeMillis();
            channel(c);
            for (int k = 0; k < now.length(); k++) {
                JSONObject o = now.getJSONObject(k);
                long at = o.getLong("at");
                if (at <= t) continue;
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(c, o.getInt("id"), o.getString("title"), o.getString("text")));
            }
            p.edit().putString("list", json).apply();
        } catch (Exception ignored) {
        }
    }
}
