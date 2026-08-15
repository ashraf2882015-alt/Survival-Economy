package com.ashraf.worldsync;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.event.EventHandler;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.event.world.TimeSkipEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class WorldSyncPlugin extends JavaPlugin {
    private PlayerSyncBridge playerSync;

    @Override public void onEnable() {
        playerSync = new PlayerSyncBridge();
        Bukkit.getPluginManager().registerEvents(this, this);
        Bukkit.getPluginManager().registerEvents(playerSync, this);
        getCommand("worldsynctest").setExecutor((sender, command, label, args) -> {
            sender.sendMessage(ChatColor.GREEN + "WorldSync 0.2.0 enabled");
            sender.sendMessage(ChatColor.GRAY + "Local players tracked: " + playerSync.snapshots().size());
            sender.sendMessage(ChatColor.GRAY + "Remote-player rendering: bridge pending");
            return true;
        });
        getLogger().info("WorldSync enabled: world events + player movement state capture.");
    }

    @EventHandler public void onPlace(BlockPlaceEvent e) {
        getLogger().info("BLOCK_PLACE " + e.getBlock().getWorld().getName() + " " + e.getBlock().getX() + " " + e.getBlock().getY() + " " + e.getBlock().getZ() + " " + e.getBlock().getBlockData().getAsString());
    }

    @EventHandler public void onBreak(BlockBreakEvent e) {
        getLogger().info("BLOCK_BREAK " + e.getBlock().getWorld().getName() + " " + e.getBlock().getX() + " " + e.getBlock().getY() + " " + e.getBlock().getZ());
    }

    @EventHandler public void onWeather(WeatherChangeEvent e) {
        getLogger().info("WEATHER " + e.getWorld().getName() + " storm=" + e.toWeatherState());
    }

    @EventHandler public void onTimeSkip(TimeSkipEvent e) {
        getLogger().info("TIME_SKIP " + e.getWorld().getName() + " " + e.getSkipAmount());
    }
}
