package ua.fin.manager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Після перезавантаження телефона відновлює збережені нагадування. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String list = c.getSharedPreferences("reminders", Context.MODE_PRIVATE).getString("list", "[]");
        Reminders.schedule(c, list);
    }
}
