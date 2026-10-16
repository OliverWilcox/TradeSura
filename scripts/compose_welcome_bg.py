# Builds mobile/assets/brand/welcome-bg.jpg (W0 + sign-in background) from
# the supplied 16:9 photo app/assets/brand/sign-up-bg.jpg. The target renders
# are portrait, so the photo is placed to match their framing (fitted against
# feature points in the W0 render: fingertip, tablet corner, plant, spotlight),
# its edges extended by mirroring, and graded into navy #0B1A2E top-to-bottom
# so text and CTAs sit on dark. The render's 9:16 frame occupies the bottom
# of the 1179x2556 asset (screens anchor it to the bottom edge); the extra
# height above covers taller 19.5:9 phones. Run: python3 scripts/compose_welcome_bg.py
import os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageFilter
W,H=1179,2556
K=W/819                       # render px -> canvas px
RH=int(1456*K)                # render-height region in canvas
OY=H-RH                       # render region sits at the bottom; extra height extends upward
src=Image.open(os.path.join(ROOT,'app/assets/brand/sign-up-bg.jpg')).convert('RGB')
s=0.86*K; iw,ih=round(1600*s),round(900*s); ix,iy=round(-267*K),round(136*K)+OY
img=src.resize((iw,ih),Image.LANCZOS)
canvas=Image.new('RGB',(W,H),(11,26,46))
# extend edges by mirroring, so structure continues across the join
band=min(iy,round(220*K))      # mirror only the cabinet/wall band, never the hand
mir=img.crop((0,0,iw,band)).transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(8))
ext=np.zeros((iy,iw,3))
ext[iy-band:]=np.array(mir,float)
if iy>band:
    # above the mirror: its outermost rows stretched and blurred, crossfaded in
    fill=np.array(mir.crop((0,0,iw,30)).resize((iw,iy)).filter(ImageFilter.GaussianBlur(40)),float)
    ramp=np.clip((np.arange(iy)-(iy-band))/140,0,1)[:,None,None]
    ext=fill*(1-ramp)+ext*ramp
canvas.paste(Image.fromarray(ext.astype('uint8')),(ix,0))
bot=img.crop((0,ih-min(ih,H-(iy+ih)),iw,ih)).transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(14))
canvas.paste(bot,(ix,iy+ih))
canvas.paste(img,(ix,iy))
# navy overlay, alpha profile over render-fraction
stops=[(0,.4),(.07,.26),(.2,.08),(.36,.1),(.48,.28),(.56,.5),(.6,.66),(.64,.82),(.70,.93),(.78,.98),(1,1)]
navy=np.array([11,26,46],float)
a=np.zeros(H)
for y in range(H):
    f=(y-OY)/RH
    if f<0: a[y]=min(.8,stops[0][1]+(-f)*0.6); continue
    for (f0,a0),(f1,a1) in zip(stops,stops[1:]):
        if f0<=f<=f1: a[y]=a0+(a1-a0)*(f-f0)/(f1-f0); break
    else: a[y]=1
C=np.array(canvas,float)
C=C*(1-a[:,None,None])+navy*a[:,None,None]
out=Image.fromarray(C.clip(0,255).astype('uint8'))
out.save(os.path.join(ROOT,'mobile/assets/brand/welcome-bg.jpg'),quality=86)
