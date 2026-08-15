package com.ashraf.worldsync;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.event.world.TimeSkipEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class WorldSyncPlugin extends JavaPlugin implements Listener {
    @Override public void onEnable() {
        Bukkit.getPluginManager().registerEvents(this, this);
        getCommand("worldsynctest").setExecutor((sender, command, label, args) -> {
            sender.sendMessage(ChatColor.GREEN + "WorldSync 0.1.0 is enabled on " + Bukkit.getServer().getName());
            sender.sendMessage(ChatColor.GRAY + "Mode: local event capture (bridge not enabled yet)");
            return true;
        });
        getLogger().info("WorldSync enabled. Local block/time/weather events are being observed.");
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
