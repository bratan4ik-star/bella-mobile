package ua.fin.manager;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        Reminders.channel(c);
        PendingIntent open = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(c, Reminders.CHANNEL)
                .setSmallIcon(c.getApplicationInfo().icon)
                .setContentTitle(i.getStringExtra("title"))
                .setContentText(i.getStringExtra("text"))
                .setStyle(new Notification.BigTextStyle().bigText(i.getStringExtra("text")))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build();
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(i.getIntExtra("id", 0), n);
    }
}
