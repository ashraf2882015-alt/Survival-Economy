package com.ashraf.worldsync;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Player state capture plus an experimental Paper server-transfer mechanism.
 * This does not create NPCs/fake players. A player is actually transferred
 * to the destination Paper server using Paper's Player.transfer API.
 */
public final class PlayerSyncBridge implements Listener {
    public record Snapshot(UUID uuid, String name, String world, double x, double y, double z,
                           float yaw, float pitch, boolean sneaking, boolean sprinting) {}

    private final JavaPlugin plugin;
    private final Map<UUID, Snapshot> players = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastTransfer = new ConcurrentHashMap<>();

    public PlayerSyncBridge(JavaPlugin plugin) {
        this.plugin = plugin;
    }

    @EventHandler public void join(PlayerJoinEvent e) { capture(e.getPlayer()); }

    @EventHandler public void quit(PlayerQuitEvent e) {
        players.remove(e.getPlayer().getUniqueId());
        lastTransfer.remove(e.getPlayer().getUniqueId());
    }

    @EventHandler(ignoreCancelled = true)
    public void move(PlayerMoveEvent e) {
        if (e.getTo() == null) return;
        capture(e.getPlayer());
        checkTransfer(e.getPlayer(), e.getTo().getX());
    }

    private void checkTransfer(Player player, double x) {
        if (!plugin.getConfig().getBoolean("transfer.enabled", false)) return;

        double maxX = plugin.getConfig().getDouble("transfer.max-x", 30000000);
        double minX = plugin.getConfig().getDouble("transfer.min-x", -30000000);
        String target = plugin.getConfig().getString("transfer.next-server", "").trim();
        if (target.isEmpty()) return;
        if (x < minX || x >= maxX) {
            long now = System.currentTimeMillis();
            long cooldown = plugin.getConfig().getLong("transfer.cooldown-ms", 5000);
            long previous = lastTransfer.getOrDefault(player.getUniqueId(), 0L);
            if (now - previous < cooldown) return;
            lastTransfer.put(player.getUniqueId(), now);

            String host = target;
            int port = 25565;
            int colon = target.lastIndexOf(':');
            if (colon > 0 && colon < target.length() - 1) {
                host = target.substring(0, colon);
                try {
                    port = Integer.parseInt(target.substring(colon + 1));
                } catch (NumberFormatException ex) {
                    plugin.getLogger().warning("Invalid next-server port: " + target);
                    return;
                }
            }

            final String destinationHost = host;
            final int destinationPort = port;
            Bukkit.getScheduler().runTask(plugin, () -> {
                try {
                    plugin.getLogger().info("Transferring " + player.getName() + " to " + destinationHost + ":" + destinationPort);
                    player.transfer(destinationHost, destinationPort);
                } catch (IllegalStateException ex) {
                    plugin.getLogger().warning("Player transfer failed: " + ex.getMessage());
                    lastTransfer.remove(player.getUniqueId());
                }
            });
        }
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
