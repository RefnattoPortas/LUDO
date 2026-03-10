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

new Phaser.Game(config);
