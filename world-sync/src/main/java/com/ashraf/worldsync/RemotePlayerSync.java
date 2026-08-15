package com.ashraf.worldsync;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Lightweight cross-server presence cache.
 * The actual cross-Aternos transport is intentionally separated from the
 * Bukkit listener so the same plugin can later use a bridge endpoint.
 */
public final class RemotePlayerSync implements Listener {
    public record Remote(UUID uuid, String name, String server, double x, double y, double z,
                         float yaw, float pitch, boolean sneaking, boolean sprinting) {}

    private final Map<UUID, Remote> remotePlayers = new ConcurrentHashMap<>();

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        publish(event.getPlayer());
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        remotePlayers.remove(event.getPlayer().getUniqueId());
    }

    public void publish(Player player) {
        var l = player.getLocation();
        remotePlayers.put(player.getUniqueId(), new Remote(
                player.getUniqueId(), player.getName(), Bukkit.getServer().getName(),
                l.getX(), l.getY(), l.getZ(), l.getYaw(), l.getPitch(),
                player.isSneaking(), player.isSprinting()));
    }

    public Map<UUID, Remote> snapshot() {
        return Map.copyOf(remotePlayers);
    }
}
