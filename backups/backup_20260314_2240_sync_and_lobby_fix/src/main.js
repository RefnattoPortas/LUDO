import { MenuScene } from './scenes/MenuScene';
import { ColorPickScene } from './scenes/ColorPickScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';

const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    parent: 'app',
    backgroundColor: '#000000',
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: '100%',
        height: '100%'
    },
    scene: [MenuScene, ColorPickScene, LobbyScene, GameScene]
};

const game = new Phaser.Game(config);

// Global cleanup on window close/refresh
window.addEventListener('beforeunload', async () => {
    const activeScene = game.scene.getScenes(true)[0];
    if (activeScene && activeScene.joinedRoom && activeScene.myColor) {
        // Simple fetch-like delete to be as fast as possible on exit
        const SUPABASE_URL = 'https://ebujbtckuqiidxdnjpgl.supabase.co';
        const SUPABASE_KEY = 'sb_publishable_ZgG1kV-reMXnCClN6eW1bw_Wp93APF4';
        
        const url = `${SUPABASE_URL}/rest/v1/ludo_players?room_id=eq.${activeScene.joinedRoom.id}&color=eq.${activeScene.myColor}`;
        navigator.sendBeacon(url, JSON.stringify({
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        }));
    }
});
