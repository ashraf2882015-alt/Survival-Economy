package com.ashraf.worldsync;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * First-stage player presence/movement state for the external WorldSync bridge.
 * This deliberately does not create fake players yet: the bridge will consume
 * these snapshots and render remote players safely on the destination server.
 */
public final class PlayerSyncBridge implements Listener {
    public record Snapshot(UUID uuid, String name, String world, double x, double y, double z,
                           float yaw, float pitch, boolean sneaking, boolean sprinting) {}

    private final Map<UUID, Snapshot> players = new ConcurrentHashMap<>();

    @EventHandler public void join(PlayerJoinEvent e) { capture(e.getPlayer()); }
    @EventHandler public void quit(PlayerQuitEvent e) { players.remove(e.getPlayer().getUniqueId()); }

    @EventHandler(ignoreCancelled = true)
    public void move(PlayerMoveEvent e) {
        if (e.getTo() == null) return;
        capture(e.getPlayer());
    }

    private void capture(Player p) {
        var l = p.getLocation();
        players.put(p.getUniqueId(), new Snapshot(
                p.getUniqueId(), p.getName(), p.getWorld().getName(),
                l.getX(), l.getY(), l.getZ(), l.getYaw(), l.getPitch(),
                p.isSneaking(), p.isSprinting()));
    }

    public Map<UUID, Snapshot> snapshots() { return Map.copyOf(players); }

    public void clearOffline() {
        players.keySet().removeIf(id -> Bukkit.getPlayer(id) == null);
    }
}
